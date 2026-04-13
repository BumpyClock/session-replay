import { basename, dirname, join } from 'node:path'
import { listFilesRecursive, readJsonFile } from '../session-files/index.js'
import type {
  NormalizedSession,
  NormalizedTurn,
  SessionProvider,
  SessionRef,
} from '../../src/lib/session/contracts.js'
import {
  createSessionRef,
  createTextBlock,
  createToolCall,
  createTurn,
  displayNameFromPath,
  finalizeTurns,
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
  content?: string
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

export function createGeminiProvider(): SessionProvider {
  return {
    source: 'gemini',
    discover: async ({ homeDir }) => {
      const rootPath = join(homeDir, '.gemini', 'tmp')
      const files = await listFilesRecursive(rootPath, (filePath) => filePath.endsWith('.json') && (filePath.includes('/chats/') || filePath.includes('\\chats\\')))
      const refs: SessionRef[] = []

      for (const file of files) {
        const session = await loadGeminiSession({
          filePath: file.path,
          homeDirectory: homeDir,
        })
        refs.push(session.ref)
      }

      return refs
    },
    load: async (ref) => {
      return loadGeminiSession({
        filePath: ref.path,
        homeDirectory: '',
      })
    },
  }
}

async function loadGeminiSession(input: {
  filePath: string
  homeDirectory: string
}): Promise<NormalizedSession> {
  const file = await readJsonFile<GeminiFile>(input.filePath)
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null

  for (const message of file.messages ?? []) {
    if (message.type === 'user') {
      currentTurn = createTurn({
        filePath: input.filePath,
        id: `gemini:${turns.length}`,
        index: turns.length,
        provider: 'gemini',
        timestamp: message.timestamp ?? null,
        userText: message.content?.trim() ?? '',
      })
      turns.push(currentTurn)
      continue
    }

    if (message.type !== 'gemini') {
      continue
    }

    if (!currentTurn) {
      currentTurn = createTurn({
        filePath: input.filePath,
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
        filePath: input.filePath,
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
      currentTurn.toolCalls.push(
        createToolCall({
          filePath: input.filePath,
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

    if (message.content?.trim()) {
      const block = createTextBlock({
        filePath: input.filePath,
        id: `${currentTurn.id}:assistant:${currentTurn.assistantBlocks.length}`,
        kind: 'text',
        provider: 'gemini',
        text: message.content,
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
    basename(dirname(dirname(input.filePath))).slice(0, 12) ||
    file.projectHash?.slice(0, 12) ||
    displayNameFromPath(input.filePath)

  return {
    ref: createSessionRef({
      cwd: null,
      homeDirectory: input.homeDirectory || '/',
      path: input.filePath,
      project,
      source: 'gemini',
      startedAt: file.startTime ?? normalizedTurns[0]?.timestamp ?? null,
      title: summary ?? displayNameFromPath(input.filePath),
      updatedAt: file.lastUpdated ?? normalizedTurns.at(-1)?.timestamp ?? null,
    }),
    cwd: null,
    warnings: [],
    turns: normalizedTurns,
  }
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
  const result = [output, error && error !== '(none)' ? error : null].filter(Boolean).join('\n\n') || null
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
