import { join } from 'node:path'
import type { JsonLineEntry } from '../session-files/filesystem.js'
import {
  findSiblingText,
  listFilesRecursive,
  readJsonLines,
} from '../session-files/index.js'
import type {
  IndexedSessionEntry,
  NormalizedSession,
  NormalizedTurn,
  SessionCatalogProvider,
  SessionFileRef,
} from '../../src/lib/session/contracts.js'
import {
  appendTurnLine,
  createIndexedSessionEntry,
  createSessionFileRef,
  createSessionRef,
  createTextBlock,
  createToolCall,
  createTurn,
  displayNameFromPath,
  finalizeTurns,
  pathProjectName,
  stripTagContent,
  summarizeTurns,
  toolResultText,
} from './shared.js'

interface CopilotEntry {
  data?: Record<string, unknown>
  id?: string
  timestamp?: string
  type?: string
}

export async function scanCopilotSessions(homeDirectory: string): Promise<SessionFileRef[]> {
  const rootPath = join(homeDirectory, '.copilot', 'session-state')
  const files = await listFilesRecursive(rootPath, (filePath) => filePath.endsWith('events.jsonl'))
  return files.map((file) => createSessionFileRef('copilot', file))
}

export async function indexCopilotSession(
  file: Readonly<SessionFileRef>,
): Promise<IndexedSessionEntry> {
  const session = await loadCopilotSession(file)
  return createIndexedSessionEntry(file, session)
}

export async function loadCopilotSession(
  file: Readonly<SessionFileRef>,
): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<CopilotEntry>(file.path)
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null
  let cwd = await readWorkspaceCwd(file.path)

  for (const entry of entries) {
    const type = entry.value?.type
    if (type === 'session.start') {
      const entryCwd = readCopilotContextCwd(entry.value?.data)
      cwd = entryCwd ?? cwd
      continue
    }

    if (type === 'user.message') {
      currentTurn = createTurn({
        filePath: file.path,
        id: `copilot:${turns.length}`,
        index: turns.length,
        provider: 'copilot',
        timestamp: entry.value?.timestamp ?? null,
        userText: extractCopilotUserText(entry.value?.data),
      })
      appendTurnLine(currentTurn, entry.line)
      turns.push(currentTurn)
      continue
    }

    if (!currentTurn) {
      continue
    }

    appendTurnLine(currentTurn, entry.line)

    if (type === 'assistant.message') {
      appendCopilotAssistantMessage(currentTurn, entry, file.path)
      continue
    }

    if (type === 'tool.execution_complete') {
      completeCopilotToolCall(currentTurn, entry)
    }
  }

  const normalizedTurns = finalizeTurns(turns)
  const summary = summarizeTurns(normalizedTurns)
  const startedAt = normalizedTurns[0]?.timestamp ?? entries[0]?.value?.timestamp ?? null
  const updatedAt =
    [...normalizedTurns].reverse().find((turn) => turn.timestamp)?.timestamp ??
    new Date(file.fingerprint.mtimeMs).toISOString()

  return {
    ref: createSessionRef({
      cwd,
      homeDirectory: '/',
      idPath: file.relativePath,
      path: file.path,
      project: pathProjectName(cwd, displayNameFromPath(file.path)),
      source: 'copilot',
      startedAt,
      title: summary ?? displayNameFromPath(file.path),
      updatedAt,
    }),
    cwd,
    warnings,
    turns: normalizedTurns,
  }
}

export function createCopilotProvider(): SessionCatalogProvider {
  return {
    source: 'copilot',
    scan: async ({ homeDir }) => scanCopilotSessions(homeDir),
    index: indexCopilotSession,
    load: loadCopilotSession,
  }
}

async function readWorkspaceCwd(filePath: string): Promise<string | null> {
  const yaml = await findSiblingText(filePath, 'workspace.yaml')
  if (!yaml) {
    return null
  }

  const match = yaml.match(/^cwd:\s*(.+)$/m)
  return match?.[1]?.trim() ?? null
}

function readCopilotContextCwd(data: Record<string, unknown> | undefined): string | null {
  const context = data?.context
  if (!context || typeof context !== 'object') {
    return null
  }

  return typeof (context as Record<string, unknown>).cwd === 'string'
    ? String((context as Record<string, unknown>).cwd)
    : null
}

function extractCopilotUserText(data: Record<string, unknown> | undefined): string {
  const transformed = typeof data?.transformedContent === 'string' ? data.transformedContent : ''
  if (transformed) {
    const withoutDate = stripTagContent(transformed, 'current_datetime')
    const withoutReminder = stripTagContent(withoutDate, 'reminder')
    return withoutReminder.trim() || (typeof data?.content === 'string' ? data.content.trim() : '')
  }

  return typeof data?.content === 'string' ? data.content.trim() : ''
}

function appendCopilotAssistantMessage(
  turn: NormalizedTurn,
  entry: JsonLineEntry<CopilotEntry>,
  filePath: string,
): void {
  const data = entry.value?.data
  if (!data) {
    return
  }

  if (typeof data.reasoningText === 'string') {
    const block = createTextBlock({
      filePath,
      id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
      kind: 'thinking',
      provider: 'copilot',
      text: data.reasoningText,
      timestamp: entry.value?.timestamp ?? null,
      line: entry.line,
      rawTypes: ['assistant.message', 'reasoning'],
    })
    if (block) {
      turn.assistantBlocks.push(block)
    }
  }

  if (typeof data.content === 'string' && data.content.trim()) {
    const block = createTextBlock({
      filePath,
      id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
      kind: 'text',
      provider: 'copilot',
      text: data.content,
      timestamp: entry.value?.timestamp ?? null,
      line: entry.line,
      rawTypes: ['assistant.message'],
    })
    if (block) {
      turn.assistantBlocks.push(block)
    }
  }

  const toolRequests = Array.isArray(data.toolRequests) ? data.toolRequests : []
  for (const request of toolRequests) {
    if (!request || typeof request !== 'object') {
      continue
    }

    const record = request as Record<string, unknown>
    const normalized = normalizeCopilotTool(record)
    if (!normalized) {
      continue
    }

    turn.toolCalls.push(
      createToolCall({
        filePath,
        id:
          typeof record.toolCallId === 'string'
            ? record.toolCallId
            : `${turn.id}:tool:${turn.toolCalls.length}`,
        input: normalized.input,
        name: normalized.name,
        provider: 'copilot',
        timestamp: entry.value?.timestamp ?? null,
        line: entry.line,
        rawTypes: ['assistant.message', 'tool_request'],
      }),
    )
  }
}

function normalizeCopilotTool(
  request: Record<string, unknown>,
): { input: Record<string, unknown>; name: string } | null {
  const name = typeof request.name === 'string' ? request.name : ''
  const argumentsValue =
    request.arguments && typeof request.arguments === 'object'
      ? (request.arguments as Record<string, unknown>)
      : {}

  if (name === 'report_intent') {
    return null
  }

  if (name === 'powershell' || name === 'bash' || name === 'shell') {
    return {
      name: 'Bash',
      input: {
        command: typeof argumentsValue.command === 'string' ? argumentsValue.command : '',
      },
    }
  }

  if (name === 'view' || name === 'read') {
    return {
      name: 'Read',
      input: {
        file_path:
          typeof argumentsValue.path === 'string'
            ? argumentsValue.path
            : typeof argumentsValue.file_path === 'string'
              ? argumentsValue.file_path
              : '',
      },
    }
  }

  if (name === 'edit') {
    return {
      name: 'Edit',
      input: {
        file_path: typeof argumentsValue.path === 'string' ? argumentsValue.path : '',
        old_string: typeof argumentsValue.old_str === 'string' ? argumentsValue.old_str : '',
        new_string: typeof argumentsValue.new_str === 'string' ? argumentsValue.new_str : '',
      },
    }
  }

  return {
    name,
    input: argumentsValue,
  }
}

function completeCopilotToolCall(turn: NormalizedTurn, entry: JsonLineEntry<CopilotEntry>): void {
  const data = entry.value?.data
  if (!data || typeof data.toolCallId !== 'string') {
    return
  }

  const toolCall = [...turn.toolCalls].reverse().find((candidate) => candidate.id === data.toolCallId)
  if (!toolCall) {
    return
  }

  const resultRecord =
    data.result && typeof data.result === 'object'
      ? (data.result as Record<string, unknown>)
      : {}

  toolCall.result = toolResultText(resultRecord.detailedContent ?? resultRecord.content)
  toolCall.resultTimestamp = entry.value?.timestamp ?? null
  toolCall.isError = data.success === false
}
