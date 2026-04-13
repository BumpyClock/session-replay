import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { SessionCatalogService } from '../catalog/session-catalog-service'
import type { SessionCatalogProvider } from '../catalog/types'
import type { JsonLineEntry } from '../session-files/filesystem.js'
import { listFilesRecursive, readJsonLines } from '../session-files/index.js'
import type {
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef as ApiSessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'
import type {
  NormalizedSession,
  NormalizedTurn,
  SessionFileRef,
  SessionRef,
  SessionWarning,
} from '../../src/lib/session/contracts.js'
import {
  createSessionStats,
  toMaterializedReplaySession,
} from '../../src/lib/session/materialize.js'
import {
  appendTurnLine,
  attachToolResult,
  createIndexedSessionEntry,
  createSessionFileRef,
  createSessionRef,
  createTextBlock,
  createToolCall,
  createTurn,
  displayNameFromPath,
  finalizeTurns,
  pathProjectName,
  summarizeTurns,
  toolResultText,
} from './shared.js'

interface CodexEntry {
  item?: Record<string, unknown>
  payload?: Record<string, unknown>
  timestamp?: string
  type?: string
}

interface PatchToolSpec {
  input: Record<string, string>
  name: string
}

interface CodexParseContext {
  cwd: string | null
  entries: JsonLineEntry<CodexEntry>[]
  file: Readonly<SessionFileRef>
  warnings: SessionWarning[]
}

export async function discoverCodexSessions(
  homeDirectory = resolveHomeDir(),
): Promise<readonly ApiSessionRef[]> {
  const refs = await createCodexCatalog(homeDirectory).listSessions()
  return refs.map((ref) => toCodexApiSessionRef(ref))
}

export async function loadCodexSession(
  request: SessionLoadRequest & { homeDirectory?: string },
): Promise<MaterializedReplaySession> {
  const homeDirectory = request.homeDirectory ?? resolveHomeDir()
  const session = await createCodexCatalog(homeDirectory).loadSession(request)
  return toMaterializedReplaySession(session)
}

export async function searchCodexSessions(
  homeDirectory: string,
  request: SessionSearchRequest,
): Promise<readonly ApiSessionRef[]> {
  const refs = await createCodexCatalog(homeDirectory).searchSessions(request)
  return refs.map((ref) => toCodexApiSessionRef(ref))
}

export async function createSessionSource({ homeDirectory = resolveHomeDir() } = {}): Promise<{
  listSessions(): Promise<readonly ApiSessionRef[]>
  loadSession(request: SessionLoadRequest): Promise<MaterializedReplaySession>
  searchSessions(request: SessionSearchRequest): Promise<readonly ApiSessionRef[]>
}> {
  const catalog = createCodexCatalog(homeDirectory)

  return {
    listSessions: async () => {
      const refs = await catalog.listSessions()
      return refs.map((ref) => toCodexApiSessionRef(ref))
    },
    loadSession: async (request) => {
      const session = await catalog.loadSession(request)
      return toMaterializedReplaySession(session)
    },
    searchSessions: async (request) => {
      const refs = await catalog.searchSessions(request)
      return refs.map((ref) => toCodexApiSessionRef(ref))
    },
  }
}

function createCodexCatalog(homeDirectory: string): SessionCatalogService {
  return new SessionCatalogService({
    homeDir: homeDirectory,
    providers: [createSessionProvider()],
  })
}

function resolveHomeDir(): string {
  return homedir()
}

export function createSessionProvider(): SessionCatalogProvider {
  return {
    source: 'codex',
    scan: async ({ homeDir }) => {
      const rootPath = join(homeDir, '.codex', 'sessions')
      const files = await listFilesRecursive(rootPath, (filePath) => filePath.endsWith('.jsonl'))
      return files.map((file) => createSessionFileRef('codex', file))
    },
    index: async (file) => {
      const session = await loadCodexCatalogSession(file)
      return createIndexedSessionEntry(file, session)
    },
    load: loadCodexCatalogSession,
  }
}

export function createCodexProvider(): SessionCatalogProvider {
  return createSessionProvider()
}

async function loadCodexCatalogSession(file: Readonly<SessionFileRef>): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<CodexEntry>(file.path)
  const context: CodexParseContext = {
    cwd: findCodexCwd(entries),
    entries,
    file,
    warnings,
  }
  const turns = finalizeTurns(
    hasModernCodexItems(entries) ? parseModernCodexTurns(context) : parseLegacyCodexTurns(context),
  )
  const summary = summarizeTurns(turns)
  const startedAt = turns[0]?.timestamp ?? entries[0]?.value?.timestamp ?? null
  const updatedAt =
    [...turns].reverse().find((turn) => turn.timestamp)?.timestamp ??
    new Date(file.fingerprint.mtimeMs).toISOString()

  const ref: SessionRef = {
    ...createSessionRef({
      cwd: context.cwd,
      homeDirectory: '/',
      idPath: file.relativePath,
      path: file.path,
      project: pathProjectName(context.cwd, inferCodexProjectName(file)),
      source: 'codex',
      startedAt,
      title: summary ?? displayNameFromPath(file.path),
      updatedAt,
    }),
    summary: summary ?? displayNameFromPath(file.path),
  }

  const session: NormalizedSession = {
    ref,
    cwd: context.cwd,
    warnings,
    turns,
  }

  session.ref.stats = createSessionStats(session)

  return {
    ref: session.ref,
    cwd: context.cwd,
    warnings,
    turns,
  }
}

function toCodexApiSessionRef(ref: Readonly<SessionRef>): ApiSessionRef {
  return {
    id: ref.id,
    title: ref.title,
    source: ref.source,
    path: ref.path,
    project: ref.project,
    cwd: ref.cwd ?? undefined,
    startedAt: ref.startedAt ?? undefined,
    updatedAt: ref.updatedAt ?? undefined,
    summary: ref.summary ?? ref.title,
    stats: ref.stats,
  }
}

function hasModernCodexItems(entries: readonly JsonLineEntry<CodexEntry>[]): boolean {
  return entries.some((entry) => entry.value?.type === 'item.completed')
}

function findCodexCwd(entries: readonly JsonLineEntry<CodexEntry>[]): string | null {
  for (const entry of entries) {
    if (entry.value?.type !== 'session_meta') {
      continue
    }

    const cwd = readCodexCwd(entry.value.payload)
    if (cwd) {
      return cwd
    }
  }

  return null
}

function parseLegacyCodexTurns(context: Readonly<CodexParseContext>): NormalizedTurn[] {
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null

  for (const entry of context.entries) {
    const type = entry.value?.type
    if (type === 'session_meta') {
      continue
    }

    if (type !== 'event_msg' && type !== 'response_item') {
      continue
    }

    if (type === 'event_msg') {
      const payloadType = typeof entry.value?.payload?.type === 'string' ? entry.value.payload.type : ''
      if (payloadType === 'task_started') {
        if (currentTurn && hasTurnContent(currentTurn)) {
          currentTurn = null
        }
        if (!currentTurn) {
          currentTurn = createCodexTurn(context.file, turns.length, entry.value?.timestamp ?? null)
          appendTurnLine(currentTurn, entry.line)
          turns.push(currentTurn)
        }
        continue
      }

      if (payloadType === 'user_message') {
        if (!currentTurn) {
          currentTurn = createCodexTurn(context.file, turns.length, entry.value?.timestamp ?? null)
          turns.push(currentTurn)
        }

        appendTurnLine(currentTurn, entry.line)
        currentTurn.timestamp = currentTurn.timestamp ?? entry.value?.timestamp ?? null
        currentTurn.userText = extractCodexUserText(
          typeof entry.value?.payload?.message === 'string' ? entry.value.payload.message : '',
        )
        continue
      }

      if (payloadType === 'task_complete') {
        currentTurn = null
      }

      continue
    }

    if (!currentTurn) {
      currentTurn = createCodexTurn(context.file, turns.length, entry.value?.timestamp ?? null)
      turns.push(currentTurn)
    }

    appendTurnLine(currentTurn, entry.line)
    appendLegacyCodexResponse(currentTurn, entry, context.file.path)
  }

  return turns
}

function parseModernCodexTurns(context: Readonly<CodexParseContext>): NormalizedTurn[] {
  const turn = createCodexTurn(context.file, 0, context.entries[0]?.value?.timestamp ?? null)

  for (const entry of context.entries) {
    if (entry.value?.type !== 'item.completed') {
      continue
    }

    const item = entry.value.item
    if (!item || typeof item !== 'object') {
      continue
    }

    appendTurnLine(turn, entry.line)
    const itemType = typeof item.type === 'string' ? item.type : ''

    if (itemType === 'message' && item.role === 'user') {
      const content = Array.isArray(item.content) ? item.content : []
      const text = content
        .map((part) => {
          if (!part || typeof part !== 'object') {
            return ''
          }

          return typeof (part as Record<string, unknown>).text === 'string'
            ? String((part as Record<string, unknown>).text)
            : ''
        })
        .filter(Boolean)
        .join('\n\n')
      turn.userText = extractCodexUserText(text)
      continue
    }

    if (itemType === 'reasoning' && typeof item.text === 'string') {
      const block = createTextBlock({
        filePath: context.file.path,
        id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
        kind: 'thinking',
        provider: 'codex',
        text: item.text,
        timestamp: entry.value?.timestamp ?? null,
        line: entry.line,
        rawTypes: ['item.completed', itemType],
      })
      if (block) {
        turn.assistantBlocks.push(block)
      }
      continue
    }

    if ((itemType === 'agent_message' || itemType === 'message') && typeof item.text === 'string') {
      const block = createTextBlock({
        filePath: context.file.path,
        id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
        kind: 'text',
        provider: 'codex',
        text: item.text,
        timestamp: entry.value?.timestamp ?? null,
        line: entry.line,
        rawTypes: ['item.completed', itemType],
      })
      if (block) {
        turn.assistantBlocks.push(block)
      }
      continue
    }

    if (itemType === 'command_execution') {
      turn.toolCalls.push(
        createToolCall({
          filePath: context.file.path,
          id: typeof item.id === 'string' ? item.id : `${turn.id}:tool:${turn.toolCalls.length}`,
          input: { command: typeof item.command === 'string' ? item.command : '' },
          isError: Number(item.exit_code ?? 0) !== 0,
          name: 'Bash',
          provider: 'codex',
          result: typeof item.aggregated_output === 'string' ? item.aggregated_output : null,
          resultTimestamp: entry.value?.timestamp ?? null,
          timestamp: entry.value?.timestamp ?? null,
          line: entry.line,
          rawTypes: ['item.completed', itemType],
        }),
      )
      continue
    }

    if (itemType === 'function_call') {
      turn.toolCalls.push(
        createToolCall({
          filePath: context.file.path,
          id: typeof item.id === 'string' ? item.id : `${turn.id}:tool:${turn.toolCalls.length}`,
          input: parseJsonString(item.arguments) ?? item.arguments,
          isError: item.status === 'failed',
          name: typeof item.name === 'string' ? item.name : 'function_call',
          provider: 'codex',
          result: typeof item.output === 'string' ? item.output : null,
          resultTimestamp: entry.value?.timestamp ?? null,
          timestamp: entry.value?.timestamp ?? null,
          line: entry.line,
          rawTypes: ['item.completed', itemType],
        }),
      )
    }
  }

  return [turn]
}

function createCodexTurn(
  file: Readonly<SessionFileRef>,
  index: number,
  timestamp: string | null,
): NormalizedTurn {
  return createTurn({
    filePath: file.path,
    id: `codex:${index}`,
    index,
    provider: 'codex',
    timestamp,
    userText: '',
  })
}

function inferCodexProjectName(file: Readonly<SessionFileRef>): string {
  const displayName = displayNameFromPath(file.path)
  const rolloutMatch = displayName.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/iu)
  return rolloutMatch?.[1]?.trim() || basename(file.relativePath.split('/')[0] ?? '') || 'session'
}

function hasTurnContent(turn: NormalizedTurn): boolean {
  return Boolean(turn.userText || turn.assistantBlocks.length > 0 || turn.toolCalls.length > 0)
}

function readCodexCwd(payload: Record<string, unknown> | undefined): string | null {
  if (!payload || typeof payload.cwd !== 'string') {
    return null
  }

  return payload.cwd
}

function extractCodexUserText(message: string): string {
  const markerMatch = message.match(/My request for Codex:\s*([\s\S]*)$/iu)
  if (markerMatch?.[1]) {
    return markerMatch[1].trim()
  }

  return message.trim()
}

function appendLegacyCodexResponse(
  turn: NormalizedTurn,
  entry: JsonLineEntry<CodexEntry>,
  filePath: string,
): void {
  const payload = entry.value?.payload
  const payloadType = typeof payload?.type === 'string' ? payload.type : ''

  if (payloadType === 'reasoning') {
    const encrypted = typeof payload?.encrypted_content === 'string' ? payload.encrypted_content : ''
    if (encrypted) {
      return
    }
  }

  if (payloadType === 'message') {
    const phase = typeof payload?.phase === 'string' ? payload.phase : 'final_answer'
    const content = Array.isArray(payload?.content) ? payload.content : []
    const kind = phase === 'commentary' ? 'thinking' : 'text'

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const text =
        typeof (item as Record<string, unknown>).text === 'string'
          ? String((item as Record<string, unknown>).text)
          : typeof (item as Record<string, unknown>).output_text === 'string'
            ? String((item as Record<string, unknown>).output_text)
            : ''

      const block = createTextBlock({
        filePath,
        id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
        kind,
        provider: 'codex',
        text,
        timestamp: entry.value?.timestamp ?? null,
        line: entry.line,
        rawTypes: [payloadType, phase],
      })
      if (block) {
        turn.assistantBlocks.push(block)
      }
    }
    return
  }

  if (payloadType === 'function_call') {
    const tool = mapCodexFunctionCall(payload, filePath, entry, turn)
    if (tool) {
      turn.toolCalls.push(tool)
    }
    return
  }

  if (payloadType === 'function_call_output') {
    const callId = typeof payload?.call_id === 'string' ? payload.call_id : ''
    attachToolResult(turn.toolCalls, callId, cleanCodexOutput(toolResultText(payload?.output)), {
      isError: false,
      resultTimestamp: entry.value?.timestamp ?? null,
    })
    return
  }

  if (payloadType === 'custom_tool_call') {
    if (payload?.name !== 'apply_patch' || typeof payload?.input !== 'string') {
      turn.toolCalls.push(
        createToolCall({
          filePath,
          id: typeof payload?.call_id === 'string' ? payload.call_id : `${turn.id}:tool:${turn.toolCalls.length}`,
          input: payload?.input ?? null,
          name: typeof payload?.name === 'string' ? payload.name : 'custom_tool_call',
          provider: 'codex',
          timestamp: entry.value?.timestamp ?? null,
          line: entry.line,
          rawTypes: [payloadType],
        }),
      )
      return
    }

    const callId = typeof payload.call_id === 'string' ? payload.call_id : `${turn.id}:patch:${turn.toolCalls.length}`
    const specs = parseApplyPatch(payload.input)
    if (specs.length === 0) {
      turn.toolCalls.push(
        createToolCall({
          filePath,
          id: callId,
          input: { patch: payload.input },
          name: 'apply_patch',
          provider: 'codex',
          timestamp: entry.value?.timestamp ?? null,
          line: entry.line,
          rawTypes: [payloadType],
        }),
      )
      return
    }

    specs.forEach((spec, index) => {
      turn.toolCalls.push(
        createToolCall({
          filePath,
          id: `${callId}:${index}`,
          input: spec.input,
          name: spec.name,
          provider: 'codex',
          timestamp: entry.value?.timestamp ?? null,
          line: entry.line,
          rawTypes: [payloadType],
        }),
      )
    })
    return
  }

  if (payloadType === 'custom_tool_call_output') {
    const callId = typeof payload?.call_id === 'string' ? payload.call_id : ''
    const output = payload?.output
    const resultText =
      output && typeof output === 'object'
        ? toolResultText((output as Record<string, unknown>).output)
        : toolResultText(output)

    const exitCode =
      output && typeof output === 'object' && (output as Record<string, unknown>).metadata
        ? Number(((output as Record<string, unknown>).metadata as Record<string, unknown>).exit_code ?? 0)
        : 0

    attachToolResult(turn.toolCalls, callId, cleanCodexOutput(resultText), {
      isError: exitCode !== 0,
      resultTimestamp: entry.value?.timestamp ?? null,
    })
  }
}

function mapCodexFunctionCall(
  payload: Record<string, unknown> | undefined,
  filePath: string,
  entry: JsonLineEntry<CodexEntry>,
  turn: NormalizedTurn,
) {
  if (!payload || typeof payload.name !== 'string') {
    return null
  }

  const callId = typeof payload.call_id === 'string' ? payload.call_id : `${turn.id}:tool:${turn.toolCalls.length}`
  const parsedInput = parseJsonString(payload.arguments)

  if (payload.name === 'exec_command') {
    const command = buildCodexCommand(parsedInput)
    return createToolCall({
      filePath,
      id: callId,
      input: { command },
      name: 'Bash',
      provider: 'codex',
      timestamp: entry.value?.timestamp ?? null,
      line: entry.line,
      rawTypes: ['function_call', 'exec_command'],
    })
  }

  return createToolCall({
    filePath,
    id: callId,
    input: parsedInput ?? payload.arguments,
    name: payload.name,
    provider: 'codex',
    timestamp: entry.value?.timestamp ?? null,
    line: entry.line,
    rawTypes: ['function_call'],
  })
}

function buildCodexCommand(value: Record<string, unknown> | null): string {
  if (!value) {
    return ''
  }

  const cmd = typeof value.cmd === 'string' ? value.cmd : ''
  const workdir = typeof value.workdir === 'string' ? value.workdir : ''

  if (cmd && workdir && !cmd.startsWith('cd ')) {
    return `cd ${workdir} && ${cmd}`
  }

  return cmd
}

function parseJsonString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function cleanCodexOutput(value: string | null): string | null {
  if (!value) {
    return value
  }

  const outputIndex = value.indexOf('Output:\n')
  if (outputIndex !== -1) {
    return value.slice(outputIndex + 'Output:\n'.length).trim()
  }

  return value.trim()
}

function parseApplyPatch(patchText: string): PatchToolSpec[] {
  const lines = patchText.replace(/\r\n/g, '\n').split('\n')
  const specs: PatchToolSpec[] = []
  let current: {
    kind: 'add' | 'delete' | 'update'
    path: string
    oldLines: string[]
    newLines: string[]
  } | null = null

  const pushCurrent = () => {
    if (!current) {
      return
    }

    if (current.kind === 'add') {
      specs.push({
        name: 'Write',
        input: {
          file_path: current.path,
          content: current.newLines.join('\n'),
        },
      })
    } else if (current.kind === 'update') {
      specs.push({
        name: 'Edit',
        input: {
          file_path: current.path,
          old_string: current.oldLines.join('\n'),
          new_string: current.newLines.join('\n'),
        },
      })
    } else if (current.kind === 'delete') {
      specs.push({
        name: 'Delete',
        input: {
          file_path: current.path,
        },
      })
    }

    current = null
  }

  for (const line of lines) {
    if (line.startsWith('*** Add File: ')) {
      pushCurrent()
      current = {
        kind: 'add',
        path: line.slice('*** Add File: '.length).trim(),
        oldLines: [],
        newLines: [],
      }
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      pushCurrent()
      current = {
        kind: 'update',
        path: line.slice('*** Update File: '.length).trim(),
        oldLines: [],
        newLines: [],
      }
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      pushCurrent()
      current = {
        kind: 'delete',
        path: line.slice('*** Delete File: '.length).trim(),
        oldLines: [],
        newLines: [],
      }
      continue
    }

    if (!current || line.startsWith('*** ') || line.startsWith('@@')) {
      continue
    }

    if (current.kind === 'add') {
      if (line.startsWith('+')) {
        current.newLines.push(line.slice(1))
      }
      continue
    }

    if (current.kind === 'update') {
      if (line.startsWith('-')) {
        current.oldLines.push(line.slice(1))
      } else if (line.startsWith('+')) {
        current.newLines.push(line.slice(1))
      } else if (line.startsWith(' ')) {
        const text = line.slice(1)
        current.oldLines.push(text)
        current.newLines.push(text)
      }
    }
  }

  pushCurrent()
  return specs
}
