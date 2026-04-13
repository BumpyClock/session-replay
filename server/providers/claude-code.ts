import { join } from 'node:path'
import type { JsonLineEntry } from '../session-files/filesystem.js'
import { listFilesRecursive, readJsonLines } from '../session-files/index.js'
import type {
  NormalizedSession,
  NormalizedTurn,
  SessionProvider,
  SessionRef,
} from '../../src/lib/session/contracts.js'
import {
  appendTurnLine,
  attachToolResult,
  createSessionRef,
  createTextBlock,
  createToolCall,
  createTurn,
  decodeProjectFromAgentDir,
  displayNameFromPath,
  extractTextFragments,
  finalizeTurns,
  summarizeTurns,
  toolResultText,
} from './shared.js'

interface ClaudeEntry {
  type?: string
  timestamp?: string
  message?: {
    content?: unknown
    role?: string
  }
}

export function createClaudeCodeProvider(): SessionProvider {
  return {
    source: 'claude-code',
    discover: async ({ homeDir }) => {
      const rootPath = join(homeDir, '.claude', 'projects')
      const files = await listFilesRecursive(rootPath, (filePath) => filePath.endsWith('.jsonl'))
      const refs: SessionRef[] = []

      for (const file of files) {
        const projectDir = file.relativePath.split('/')[0] ?? ''
        const session = await loadClaudeSession({
          filePath: file.path,
          homeDirectory: homeDir,
          project: decodeProjectFromAgentDir(projectDir),
          updatedAt: file.updatedAt,
        })
        refs.push(session.ref)
      }

      return refs
    },
    load: async (ref) => {
      return loadClaudeSession({
        filePath: ref.path,
        homeDirectory: '',
        project: ref.project,
        updatedAt: ref.updatedAt,
      })
    },
  }
}

async function loadClaudeSession(input: {
  filePath: string
  homeDirectory: string
  project: string
  updatedAt?: string | null
}): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<ClaudeEntry>(input.filePath)
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null

  for (const entry of entries) {
    const type = entry.value?.type
    if (type === 'user') {
      const userText = extractUserText(entry)
      const toolResults = extractToolResults(entry)

      if (toolResults.length > 0 && currentTurn) {
        appendTurnLine(currentTurn, entry.line)
        for (const toolResult of toolResults) {
          attachToolResult(currentTurn.toolCalls, toolResult.toolUseId, toolResult.result, {
            isError: toolResult.isError,
            resultTimestamp: entry.value?.timestamp ?? null,
          })
        }
      }

      if (!userText) {
        continue
      }

      currentTurn = createTurn({
        filePath: input.filePath,
        id: `claude:${turns.length}`,
        index: turns.length,
        provider: 'claude-code',
        timestamp: entry.value?.timestamp ?? null,
        userText,
      })
      appendTurnLine(currentTurn, entry.line)
      turns.push(currentTurn)
      continue
    }

    if (type !== 'assistant') {
      continue
    }

    if (!currentTurn) {
      currentTurn = createTurn({
        filePath: input.filePath,
        id: `claude:${turns.length}`,
        index: turns.length,
        provider: 'claude-code',
        timestamp: entry.value?.timestamp ?? null,
        userText: '',
      })
      turns.push(currentTurn)
    }

    appendTurnLine(currentTurn, entry.line)
    appendAssistantContent(currentTurn, entry, input.filePath)
  }

  const normalizedTurns = finalizeTurns(turns)
  const summary = summarizeTurns(normalizedTurns)
  const startedAt = normalizedTurns[0]?.timestamp ?? entries[0]?.value?.timestamp ?? null
  const updatedAt =
    [...normalizedTurns].reverse().find((turn) => turn.timestamp)?.timestamp ??
    input.updatedAt ??
    null

  return {
    ref: createSessionRef({
      cwd: null,
      homeDirectory: input.homeDirectory || '/',
      path: input.filePath,
      project: input.project,
      source: 'claude-code',
      startedAt,
      title: summary ?? displayNameFromPath(input.filePath),
      updatedAt,
    }),
    cwd: null,
    warnings,
    turns: normalizedTurns,
  }
}

function extractUserText(entry: JsonLineEntry<ClaudeEntry>): string {
  const content = entry.value?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }

  return extractTextFragments(content).join('\n\n').trim()
}

function extractToolResults(entry: JsonLineEntry<ClaudeEntry>): Array<{
  isError: boolean
  result: string | null
  toolUseId: string
}> {
  const content = entry.value?.message?.content
  if (!Array.isArray(content)) {
    return []
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const record = item as Record<string, unknown>
      if (record.type !== 'tool_result' || typeof record.tool_use_id !== 'string') {
        return null
      }

      return {
        toolUseId: record.tool_use_id,
        result: toolResultText(record.content),
        isError: Boolean(record.is_error),
      }
    })
    .filter((item): item is { isError: boolean; result: string | null; toolUseId: string } => Boolean(item))
}

function appendAssistantContent(
  turn: NormalizedTurn,
  entry: JsonLineEntry<ClaudeEntry>,
  filePath: string,
): void {
  const content = entry.value?.message?.content

  if (typeof content === 'string') {
    const block = createTextBlock({
      filePath,
      id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
      kind: 'text',
      provider: 'claude-code',
      text: content,
      timestamp: entry.value?.timestamp ?? null,
      line: entry.line,
      rawTypes: ['assistant'],
    })
    if (block) {
      turn.assistantBlocks.push(block)
    }
    return
  }

  if (!Array.isArray(content)) {
    return
  }

  for (const [index, item] of content.entries()) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const itemType = typeof record.type === 'string' ? record.type : 'text'

    if (itemType === 'thinking') {
      const block = createTextBlock({
        filePath,
        id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
        kind: 'thinking',
        provider: 'claude-code',
        text: typeof record.thinking === 'string' ? record.thinking : '',
        timestamp: entry.value?.timestamp ?? null,
        line: entry.line,
        rawTypes: ['thinking'],
      })
      if (block) {
        turn.assistantBlocks.push(block)
      }
      continue
    }

    if (itemType === 'tool_use') {
      const name = typeof record.name === 'string' ? record.name : 'Tool'
      const id = typeof record.id === 'string' ? record.id : `${turn.id}:tool:${index}`
      turn.toolCalls.push(
        createToolCall({
          filePath,
          id,
          input: record.input,
          name,
          provider: 'claude-code',
          timestamp: entry.value?.timestamp ?? null,
          line: entry.line,
          rawTypes: ['tool_use'],
        }),
      )
      continue
    }

    const block = createTextBlock({
      filePath,
      id: `${turn.id}:assistant:${turn.assistantBlocks.length}`,
      kind: 'text',
      provider: 'claude-code',
      text: typeof record.text === 'string' ? record.text : '',
      timestamp: entry.value?.timestamp ?? null,
      line: entry.line,
      rawTypes: [itemType],
    })
    if (block) {
      turn.assistantBlocks.push(block)
    }
  }
}
