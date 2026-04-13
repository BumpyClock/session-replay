import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import type { JsonLineEntry } from '../session-files/filesystem.js'
import { listFilesRecursive, readJsonLines } from '../session-files/index.js'
import { ApiError } from '../api/errors'
import type {
  NormalizedSession,
  NormalizedTurn,
  SessionProvider,
  SessionRef,
} from '../../src/lib/session/contracts.js'
import { sessionMatchesQuery } from '../../src/lib/session'
import {
  appendTurnLine,
  attachToolResult,
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
import {
  toApiSessionRef,
  toMaterializedReplaySession,
} from '../../src/lib/session/materialize.js'
import type {
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef as ApiSessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'

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

export async function discoverCodexSessions(
  homeDirectory = resolveHomeDir(),
): Promise<readonly ApiSessionRef[]> {
  const provider = createCodexProvider()
  const refs = await provider.discover({ homeDir: homeDirectory })

  return refs
    .map((ref) => toApiSessionRef(ref))
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
}

export async function loadCodexSession(
  request: SessionLoadRequest & { homeDirectory?: string },
): Promise<MaterializedReplaySession> {
  const homeDirectory = request.homeDirectory ?? resolveHomeDir()
  const provider = createCodexProvider()
  const refs = await provider.discover({ homeDir: homeDirectory })
  const target = resolveCodexSessionTarget(refs, request)

  if (!target) {
    throw new ApiError(404, 'session_not_found', 'Session not found')
  }

  const normalized = await provider.load(target)
  return toMaterializedReplaySession(normalized)
}

export async function searchCodexSessions(
  homeDirectory: string,
  request: SessionSearchRequest,
): Promise<readonly ApiSessionRef[]> {
  const query = request.query.trim().toLowerCase()
  if (!query) {
    return []
  }

  const provider = createCodexProvider()
  const refs = await provider.discover({ homeDir: homeDirectory })
  const found: ApiSessionRef[] = []

  for (const ref of refs) {
    const apiRef = toApiSessionRef(ref)
    const haystack = [
      apiRef.id,
      apiRef.title,
      apiRef.path,
      apiRef.source,
      apiRef.project,
      apiRef.cwd,
      apiRef.summary,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()

    if (haystack.includes(query)) {
      found.push(apiRef)
      continue
    }

    const normalized = await provider.load(ref)
    if (sessionMatchesQuery(normalized, query)) {
      found.push(toApiSessionRef(ref, normalized))
    }
  }

  return request.limit ? found.slice(0, request.limit) : found
}

export async function createSessionSource({ homeDirectory = resolveHomeDir() } = {}): Promise<{
  listSessions(): Promise<readonly ApiSessionRef[]>
  loadSession(request: SessionLoadRequest): Promise<MaterializedReplaySession>
  searchSessions(request: SessionSearchRequest): Promise<readonly ApiSessionRef[]>
}> {
  return {
    listSessions: () => discoverCodexSessions(homeDirectory),
    loadSession: (request) => loadCodexSession({ ...request, homeDirectory }),
    searchSessions: (request) => searchCodexSessions(homeDirectory, request),
  }
}

function resolveCodexSessionTarget(
  refs: readonly SessionRef[],
  request: SessionLoadRequest,
): SessionRef | null {
  const target = request.path ?? request.sessionId
  if (!target) {
    return null
  }

  const direct = refs.find((ref) => ref.path === target || ref.id === target)
  if (direct) {
    return direct
  }

  const normalized = normalizeSessionToken(target)
  const byId = refs.find((ref) => normalizeSessionToken(ref.id) === normalized)
  if (byId) {
    return byId
  }

  const byPath = refs.find((ref) => normalizeSessionToken(ref.path) === normalized)
  if (byPath) {
    return byPath
  }

  const withExt = target.endsWith('.jsonl') ? target : `${target}.jsonl`
  return (
    refs.find((ref) => basename(ref.path) === target) ??
    refs.find((ref) => basename(ref.path) === withExt) ??
    refs.find((ref) => basename(ref.path).replace(/\.jsonl$/i, '') === normalized)
  )
}

function normalizeSessionToken(value: string): string {
  return value.trim().toLowerCase().replace(/\.jsonl$/i, '')
}

function resolveHomeDir(): string {
  return homedir()
}

export function createCodexProvider(): SessionProvider {
  return {
    source: 'codex',
    discover: async ({ homeDir }) => {
      const rootPath = join(homeDir, '.codex', 'sessions')
      const files = await listFilesRecursive(rootPath, (filePath) => filePath.endsWith('.jsonl'))
      const refs: SessionRef[] = []

      for (const file of files) {
        const session = await loadCodexSessionFromFile({
          filePath: file.path,
          homeDirectory: homeDir,
          fallbackProject: basename(join(rootPath, file.relativePath.split('/').slice(0, 3).join('/'))),
          updatedAt: file.updatedAt,
        })
        refs.push(session.ref)
      }

      return refs
    },
    load: async (ref) => {
      return loadCodexSessionFromFile({
        filePath: ref.path,
        homeDirectory: '',
        fallbackProject: ref.project,
        updatedAt: ref.updatedAt,
      })
    },
  }
}

async function loadCodexSessionFromFile(input: {
  fallbackProject: string
  filePath: string
  homeDirectory: string
  updatedAt?: string | null
}): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<CodexEntry>(input.filePath)

  if (entries.some((entry) => entry.value?.type === 'item.completed')) {
    return loadModernCodexSession({
      entries,
      filePath: input.filePath,
      homeDirectory: input.homeDirectory,
      fallbackProject: input.fallbackProject,
      updatedAt: input.updatedAt,
      warnings,
    })
  }

  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null
  let discoveredCwd: string | null = null

  for (const entry of entries) {
    const type = entry.value?.type
    if (type === 'session_meta') {
      discoveredCwd = readCodexCwd(entry.value?.payload) ?? discoveredCwd
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
          currentTurn = createTurn({
            filePath: input.filePath,
            id: `codex:${turns.length}`,
            index: turns.length,
            provider: 'codex',
            timestamp: entry.value?.timestamp ?? null,
            userText: '',
          })
          appendTurnLine(currentTurn, entry.line)
          turns.push(currentTurn)
        }
        continue
      }

      if (payloadType === 'user_message') {
        if (!currentTurn) {
          currentTurn = createTurn({
            filePath: input.filePath,
            id: `codex:${turns.length}`,
            index: turns.length,
            provider: 'codex',
            timestamp: entry.value?.timestamp ?? null,
            userText: '',
          })
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
      currentTurn = createTurn({
        filePath: input.filePath,
        id: `codex:${turns.length}`,
        index: turns.length,
        provider: 'codex',
        timestamp: entry.value?.timestamp ?? null,
        userText: '',
      })
      turns.push(currentTurn)
    }

    appendTurnLine(currentTurn, entry.line)
    appendLegacyCodexResponse(currentTurn, entry, input.filePath)
  }

  const normalizedTurns = finalizeTurns(turns)
  const summary = summarizeTurns(normalizedTurns)
  const project = pathProjectName(discoveredCwd, input.fallbackProject)
  const startedAt = normalizedTurns[0]?.timestamp ?? entries[0]?.value?.timestamp ?? null
  const updatedAt =
    [...normalizedTurns].reverse().find((turn) => turn.timestamp)?.timestamp ??
    input.updatedAt ??
    null

  return {
    ref: createSessionRef({
      cwd: discoveredCwd,
      homeDirectory: input.homeDirectory || '/',
      path: input.filePath,
      project,
      source: 'codex',
      startedAt,
      title: summary ?? displayNameFromPath(input.filePath),
      updatedAt,
    }),
    cwd: discoveredCwd,
    warnings,
    turns: normalizedTurns,
  }
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

async function loadModernCodexSession(input: {
  entries: JsonLineEntry<CodexEntry>[]
  fallbackProject: string
  filePath: string
  homeDirectory: string
  updatedAt?: string | null
  warnings: NormalizedSession['warnings']
}): Promise<NormalizedSession> {
  const turn = createTurn({
    filePath: input.filePath,
    id: 'codex:0',
    index: 0,
    provider: 'codex',
    timestamp: input.entries[0]?.value?.timestamp ?? null,
    userText: '',
  })

  for (const entry of input.entries) {
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
        filePath: input.filePath,
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
        filePath: input.filePath,
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
          filePath: input.filePath,
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
          filePath: input.filePath,
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

  const normalizedTurns = finalizeTurns([turn])
  const summary = summarizeTurns(normalizedTurns)

  return {
    ref: createSessionRef({
      cwd: null,
      homeDirectory: input.homeDirectory || '/',
      path: input.filePath,
      project: input.fallbackProject,
      source: 'codex',
      startedAt: normalizedTurns[0]?.timestamp ?? null,
      title: summary ?? displayNameFromPath(input.filePath),
      updatedAt: input.updatedAt ?? null,
    }),
    cwd: null,
    warnings: input.warnings,
    turns: normalizedTurns,
  }
}
