import { basename, dirname, join } from 'node:path'
import { listFilesRecursive, readJsonFile } from '../session-files/index.js'
import type {
  IndexedSessionEntry,
  NormalizedSession,
  NormalizedTurn,
  SessionCatalogProvider,
  SessionFileRef,
} from '../../src/lib/session/contracts.js'
import {
  createIndexedSessionEntry,
  createSessionFileRef,
  createSessionRef,
  createTextBlock,
  createToolCall,
  createTurn,
  displayNameFromPath,
  extractTextFragments,
  finalizeTurns,
  normalizeWhitespace,
  summarizeTurns,
  toolResultText,
} from './shared.js'

interface GeminiFile {
  lastUpdated?: string
  messages?: GeminiMessage[]
  projectHash?: string
  startTime?: string
}

interface GeminiMessage {
  content?: unknown
  id?: string
  model?: string
  thoughts?: Array<{
    description?: string
    subject?: string
    timestamp?: string
  }>
  timestamp?: string
  toolCalls?: Array<{
    args?: Record<string, unknown>
    id?: string
    name?: string
    result?: unknown[]
    status?: string
    timestamp?: string
  }>
  type?: string
}

export async function scanGeminiSessions(homeDirectory: string): Promise<SessionFileRef[]> {
  const rootPath = join(homeDirectory, '.gemini', 'tmp')
  const files = await listFilesRecursive(
    rootPath,
    (filePath) =>
      filePath.endsWith('.json') &&
      (filePath.includes('/chats/') || filePath.includes('\\chats\\')),
  )

  return files.map((file) => createSessionFileRef('gemini', file))
}

export async function indexGeminiSession(
  file: Readonly<SessionFileRef>,
): Promise<IndexedSessionEntry> {
  const session = await loadGeminiSession(file)
  return createIndexedSessionEntry(file, session)
}

export async function loadGeminiSession(file: Readonly<SessionFileRef>): Promise<NormalizedSession> {
  const payload = await readJsonFile<GeminiFile>(file.path)
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null

  for (const message of payload.messages ?? []) {
    const messageText = normalizeGeminiMessageText(message.content)

    if (message.type === 'user') {
      currentTurn = createTurn({
        filePath: file.path,
        id: `gemini:${turns.length}`,
        index: turns.length,
        provider: 'gemini',
        timestamp: message.timestamp ?? null,
        userText: messageText,
      })
      turns.push(currentTurn)
      continue
    }

    if (message.type !== 'gemini') {
      continue
    }

    if (!currentTurn) {
      currentTurn = createTurn({
        filePath: file.path,
        id: `gemini:${turns.length}`,
        index: turns.length,
        provider: 'gemini',
        timestamp: message.timestamp ?? null,
        userText: '',
      })
      turns.push(currentTurn)
    }

    for (const thought of message.thoughts ?? []) {
      const text = [thought.subject, thought.description].filter(Boolean).join('\n\n')
      const block = createTextBlock({
        filePath: file.path,
        id: `${currentTurn.id}:assistant:${currentTurn.assistantBlocks.length}`,
        kind: 'thinking',
        provider: 'gemini',
        text,
        timestamp: thought.timestamp ?? message.timestamp ?? null,
        rawTypes: ['thought'],
      })
      if (block) {
        currentTurn.assistantBlocks.push(block)
      }
    }

    for (const toolCall of message.toolCalls ?? []) {
      const normalized = normalizeGeminiTool(toolCall)
      currentTurn.assistantBlocks.push(
        createToolCall({
          filePath: file.path,
          id: normalized.id,
          input: normalized.input,
          isError: normalized.isError,
          name: normalized.name,
          provider: 'gemini',
          result: normalized.result,
          resultTimestamp: normalized.resultTimestamp,
          timestamp: toolCall.timestamp ?? message.timestamp ?? null,
          rawTypes: ['tool_call'],
        }),
      )
    }

    if (messageText) {
      const block = createTextBlock({
        filePath: file.path,
        id: `${currentTurn.id}:assistant:${currentTurn.assistantBlocks.length}`,
        kind: 'text',
        provider: 'gemini',
        text: messageText,
        timestamp: message.timestamp ?? null,
        rawTypes: ['gemini'],
      })
      if (block) {
        currentTurn.assistantBlocks.push(block)
      }
    }
  }

  const normalizedTurns = finalizeTurns(turns)
  const summary = summarizeTurns(normalizedTurns)
  const project =
    basename(dirname(dirname(file.path))).slice(0, 12) ||
    payload.projectHash?.slice(0, 12) ||
    displayNameFromPath(file.path)

  return {
    ref: createSessionRef({
      cwd: null,
      homeDirectory: '/',
      idPath: file.relativePath,
      path: file.path,
      project,
      source: 'gemini',
      startedAt: payload.startTime ?? normalizedTurns[0]?.timestamp ?? null,
      title: summary ?? displayNameFromPath(file.path),
      updatedAt:
        payload.lastUpdated ??
        normalizedTurns.at(-1)?.timestamp ??
        new Date(file.fingerprint.mtimeMs).toISOString(),
    }),
    cwd: null,
    warnings: [],
    turns: normalizedTurns,
  }
}

export function createGeminiProvider(): SessionCatalogProvider {
  return {
    source: 'gemini',
    scan: async ({ homeDir }) => scanGeminiSessions(homeDir),
    index: indexGeminiSession,
    load: loadGeminiSession,
  }
}

function normalizeGeminiMessageText(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeWhitespace(value)
  }

  if (Array.isArray(value)) {
    return extractTextFragments(value).join('\n\n')
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>

  if (typeof record.text === 'string') {
    return normalizeWhitespace(record.text)
  }

  if (record.parts !== undefined) {
    return normalizeGeminiMessageText(record.parts)
  }

  if (record.content !== undefined) {
    return normalizeGeminiMessageText(record.content)
  }

  return ''
}

function normalizeGeminiTool(toolCall: NonNullable<GeminiMessage['toolCalls']>[number]) {
  const name = toolCall.name ?? 'tool'
  let normalizedName = name
  let normalizedInput: Record<string, unknown> = toolCall.args ?? {}

  if (name === 'run_shell_command') {
    normalizedName = 'Bash'
    normalizedInput = {
      command: typeof toolCall.args?.command === 'string' ? toolCall.args.command : '',
    }
  } else if (name === 'read_file') {
    normalizedName = 'Read'
    normalizedInput = {
      file_path:
        typeof toolCall.args?.file_path === 'string'
          ? toolCall.args.file_path
          : typeof toolCall.args?.path === 'string'
            ? toolCall.args.path
            : '',
    }
  }

  const response = findGeminiFunctionResponse(toolCall.result)
  const output = toolResultText(response?.output)
  const error = toolResultText(response?.error)
  const result =
    [output, error && error !== '(none)' ? error : null].filter(Boolean).join('\n\n') || null
  const exitCode = Number(response?.exitCode ?? 0)

  return {
    id: toolCall.id ?? `${name}:${toolCall.timestamp ?? '0'}`,
    input: normalizedInput,
    isError: toolCall.status === 'error' || exitCode !== 0,
    name: normalizedName,
    result,
    resultTimestamp: toolCall.timestamp ?? null,
  }
}

function findGeminiFunctionResponse(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) {
    return null
  }

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const functionResponse = (item as Record<string, unknown>).functionResponse
    if (!functionResponse || typeof functionResponse !== 'object') {
      continue
    }

    const response = (functionResponse as Record<string, unknown>).response
    if (response && typeof response === 'object') {
      return response as Record<string, unknown>
    }
  }

  return null
}
