import { join } from 'node:path'
import type { JsonLineEntry } from '../session-files/filesystem.js'
import { listFilesRecursive, readJsonLines } from '../session-files/index.js'
import type {
  IndexedSessionEntry,
  NormalizedSession,
  NormalizedTurn,
  SessionCatalogProvider,
  SessionFileRef,
} from '../catalog/types.js'
import {
  appendTurnLine,
  attachToolResult,
  createIndexedSessionEntry,
  createSessionFileRef,
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

export async function scanClaudeCodeSessions(homeDirectory: string): Promise<SessionFileRef[]> {
  const rootPath = join(homeDirectory, '.claude', 'projects')
  const files = await listFilesRecursive(rootPath, (filePath) => filePath.endsWith('.jsonl'))
  return files.map((file) => createSessionFileRef('claude-code', file))
}

export async function indexClaudeCodeSession(
  file: Readonly<SessionFileRef>,
): Promise<IndexedSessionEntry> {
  const session = await loadClaudeCodeSession(file)
  return createIndexedSessionEntry(file, session)
}

/**
 * Load one Claude Code transcript, synthesizing system turns for top-level
 * runtime records and merging user-side tool_result entries back into tools.
 */
export async function loadClaudeCodeSession(
  file: Readonly<SessionFileRef>,
): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<ClaudeEntry>(file.path)
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null

  for (const entry of entries) {
    const type = entry.value?.type
    const systemTag = mapClaudeSystemTag(type)
    if (systemTag) {
      turns.push(createClaudeSystemTurn(file, turns.length, entry, systemTag))
      continue
    }

    if (type === 'user') {
      const userText = extractUserText(entry)
      const toolResults = extractToolResults(entry)

      if (toolResults.length > 0 && currentTurn) {
        appendTurnLine(currentTurn, entry.line)
        for (const toolResult of toolResults) {
          attachToolResult(currentTurn.assistantBlocks, toolResult.toolUseId, toolResult.result, {
            isError: toolResult.isError,
            resultTimestamp: entry.value?.timestamp ?? null,
          })
        }
      }

      if (!userText) {
        continue
      }

      currentTurn = createTurn({
        filePath: file.path,
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
        filePath: file.path,
        id: `claude:${turns.length}`,
        index: turns.length,
        provider: 'claude-code',
        timestamp: entry.value?.timestamp ?? null,
        userText: '',
      })
      turns.push(currentTurn)
    }

    appendTurnLine(currentTurn, entry.line)
    appendAssistantContent(currentTurn, entry, file.path)
  }

  const normalizedTurns = finalizeTurns(turns)
  const summary = summarizeTurns(normalizedTurns)
  const startedAt = normalizedTurns[0]?.timestamp ?? entries[0]?.value?.timestamp ?? null
  const updatedAt =
    [...normalizedTurns].reverse().find((turn) => turn.timestamp)?.timestamp ??
    new Date(file.fingerprint.mtimeMs).toISOString()
  const projectDir = file.relativePath.split('/')[0] ?? ''

  return {
    ref: createSessionRef({
      cwd: null,
      homeDirectory: '/',
      idPath: file.relativePath,
      path: file.path,
      project: decodeProjectFromAgentDir(projectDir),
      source: 'claude-code',
      startedAt,
      title: summary ?? displayNameFromPath(file.path),
      updatedAt,
    }),
    cwd: null,
    warnings,
    turns: normalizedTurns,
  }
}

export function createSessionProvider(): SessionCatalogProvider {
  return {
    source: 'claude-code',
    scan: async ({ homeDir }) => scanClaudeCodeSessions(homeDir),
    index: indexClaudeCodeSession,
    load: loadClaudeCodeSession,
  }
}

/** Legacy alias retained for callers that import the older provider name. */
export function createClaudeCodeProvider(): SessionCatalogProvider {
  return createSessionProvider()
}

function mapClaudeSystemTag(type: string | undefined): string | null {
  switch (type) {
    case 'attachment':
      return 'claude_attachment'
    case 'progress':
      return 'claude_progress'
    case 'system':
      return 'claude_system'
    case 'queue-operation':
      return 'queue_operation'
    case 'permission-mode':
      return 'permission_mode'
    case 'file-history-snapshot':
      return 'file_history_snapshot'
    case 'agent-name':
      return 'agent_name'
    case 'custom-title':
      return 'custom_title'
    case 'pr-link':
      return 'pr_link'
    default:
      return null
  }
}

function createClaudeSystemTurn(
  file: Readonly<SessionFileRef>,
  index: number,
  entry: JsonLineEntry<ClaudeEntry>,
  tagName: string,
): NormalizedTurn {
  const turn = createTurn({
    filePath: file.path,
    id: `claude:${index}`,
    index,
    provider: 'claude-code',
    timestamp: entry.value?.timestamp ?? null,
    userText: '',
  })
  appendTurnLine(turn, entry.line)
  const block = createTextBlock({
    filePath: file.path,
    id: `${turn.id}:system:0`,
    kind: 'text',
    provider: 'claude-code',
    text: `<${tagName}>${entry.raw}</${tagName}>`,
    timestamp: entry.value?.timestamp ?? null,
    line: entry.line,
    rawTypes: [entry.value?.type ?? '', tagName],
  })
  if (block) {
    turn.systemBlocks.push(block)
  }

  return turn
}

function extractUserText(entry: JsonLineEntry<ClaudeEntry>): string {
  const content = entry.value?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .flatMap((item) => {
      if (typeof item === 'string') {
        return [item]
      }

      if (!item || typeof item !== 'object') {
        return []
      }

      const record = item as Record<string, unknown>
      if (record.type === 'tool_result') {
        return []
      }

      return extractTextFragments([record])
    })
    .join('\n\n')
    .trim()
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
      turn.assistantBlocks.push(
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
