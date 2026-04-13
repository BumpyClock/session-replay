import { join } from 'node:path'
import type { JsonLineEntry } from '../session-files/filesystem.js'
import {
  findSiblingText,
  listFilesRecursive,
  readJsonLines,
} from '../session-files/index.js'
import type {
  NormalizedSession,
  NormalizedTurn,
  SessionProvider,
  SessionRef,
} from '../../src/lib/session/contracts.js'
import {
  appendTurnLine,
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

export interface CopilotLoadRequest {
  homeDirectory: string
  path: string
  updatedAt?: string | null
}

export interface CopilotSearchRequest {
  homeDirectory: string
  query: string
  limit?: number
}

export async function discoverCopilotSessions(homeDirectory: string): Promise<SessionRef[]> {
  const rootPath = join(homeDirectory, ".copilot", "session-state")
  const files = await listFilesRecursive(rootPath, (filePath) => filePath.endsWith("events.jsonl"))
  const refs: SessionRef[] = []

  for (const file of files) {
    const session = await loadCopilotSession({
      homeDirectory,
      path: file.path,
      updatedAt: file.updatedAt,
    })
    refs.push(session.ref)
  }

  return refs.sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
  )
}

export async function loadCopilotSession({
  homeDirectory,
  path,
  updatedAt = null,
}: CopilotLoadRequest): Promise<NormalizedSession> {
  return loadCopilotSessionFromFile({
    homeDirectory,
    filePath: path,
    updatedAt,
  })
}

export async function searchCopilotSessions({
  homeDirectory,
  query,
  limit,
}: CopilotSearchRequest): Promise<readonly SessionRef[]> {
  const lowered = query.trim().toLowerCase()
  if (!lowered) {
    return []
  }

  const sessions = await discoverCopilotSessions(homeDirectory)
  const results: SessionRef[] = []

  for (const session of sessions) {
    const metadataHaystack = [
      session.id,
      session.title,
      session.path,
      session.project,
      session.cwd,
      session.summary,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

    if (metadataHaystack.includes(lowered)) {
      results.push(session)
    }
  }

  return typeof limit === "number" ? results.slice(0, limit) : results
}

export function createCopilotProvider(): SessionProvider {
  return {
    source: 'copilot',
    discover: async ({ homeDir }) => {
      return discoverCopilotSessions(homeDir)
    },
    load: async (ref) => {
      return loadCopilotSession({
        homeDirectory: '',
        updatedAt: ref.updatedAt,
        path: ref.path,
      })
    },
  }
}

async function loadCopilotSessionFromFile(input: {
  filePath: string
  homeDirectory: string
  updatedAt?: string | null
}): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<CopilotEntry>(input.filePath)
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null
  let cwd = await readWorkspaceCwd(input.filePath)

  for (const entry of entries) {
    const type = entry.value?.type
    if (type === 'session.start') {
      const entryCwd = readCopilotContextCwd(entry.value?.data)
      cwd = entryCwd ?? cwd
      continue
    }

    if (type === 'user.message') {
      currentTurn = createTurn({
        filePath: input.filePath,
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
      appendCopilotAssistantMessage(currentTurn, entry, input.filePath)
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
    input.updatedAt ??
    null
  const ref = createSessionRef({
    cwd,
    homeDirectory: input.homeDirectory || '/',
    path: input.filePath,
    project: pathProjectName(cwd, displayNameFromPath(input.filePath)),
    source: 'copilot',
    startedAt,
    title: summary ?? displayNameFromPath(input.filePath),
    updatedAt,
  })

  return {
    source: 'copilot',
    ref,
    id: ref.id,
    title: ref.title,
    project: ref.project,
    cwd,
    warnings,
    summary,
    startedAt: ref.startedAt,
    updatedAt: ref.updatedAt,
    turns: normalizedTurns,
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
        id: typeof record.toolCallId === 'string' ? record.toolCallId : `${turn.id}:tool:${turn.toolCalls.length}`,
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
