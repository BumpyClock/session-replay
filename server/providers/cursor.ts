import { join } from 'node:path'
import type { JsonLineEntry } from '../session-files/filesystem.js'
import { listFilesRecursive, readJsonLines } from '../session-files/index.js'
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
  createTurn,
  decodeProjectFromAgentDir,
  displayNameFromPath,
  extractTextFragments,
  finalizeTurns,
  stripOuterTag,
  summarizeTurns,
} from './shared.js'

interface CursorEntry {
  message?: {
    content?: unknown
  }
  role?: string
  timestamp?: string
}

export async function scanCursorSessions(homeDirectory: string): Promise<SessionFileRef[]> {
  const rootPath = join(homeDirectory, '.cursor', 'projects')
  const files = await listFilesRecursive(rootPath, (filePath) => {
    if (!filePath.endsWith('.jsonl')) {
      return false
    }

    return filePath.includes('/agent-transcripts/') || filePath.includes('\\agent-transcripts\\')
  })

  return files.map((file) => createSessionFileRef('cursor', file))
}

export async function indexCursorSession(
  file: Readonly<SessionFileRef>,
): Promise<IndexedSessionEntry> {
  const session = await loadCursorSession(file)
  return createIndexedSessionEntry(file, session)
}

export async function loadCursorSession(file: Readonly<SessionFileRef>): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<CursorEntry>(file.path)
  const turns: NormalizedTurn[] = []
  let currentTurn: NormalizedTurn | null = null

  for (const entry of entries) {
    const role = entry.value?.role
    if (role === 'user') {
      const userText = extractCursorUserText(entry)
      if (!userText) {
        continue
      }

      currentTurn = createTurn({
        filePath: file.path,
        id: `cursor:${turns.length}`,
        index: turns.length,
        provider: 'cursor',
        timestamp: entry.value?.timestamp ?? null,
        userText,
      })
      appendTurnLine(currentTurn, entry.line)
      turns.push(currentTurn)
      continue
    }

    if (role !== 'assistant') {
      continue
    }

    if (!currentTurn) {
      currentTurn = createTurn({
        filePath: file.path,
        id: `cursor:${turns.length}`,
        index: turns.length,
        provider: 'cursor',
        timestamp: entry.value?.timestamp ?? null,
        userText: '',
      })
      turns.push(currentTurn)
    }

    appendTurnLine(currentTurn, entry.line)
    const texts = extractTextFragments(entry.value?.message?.content)
    for (const text of texts) {
      const block = createTextBlock({
        filePath: file.path,
        id: `${currentTurn.id}:assistant:${currentTurn.assistantBlocks.length}`,
        kind: 'text',
        provider: 'cursor',
        text,
        timestamp: entry.value?.timestamp ?? null,
        line: entry.line,
        rawTypes: ['assistant'],
      })
      if (block) {
        currentTurn.assistantBlocks.push(block)
      }
    }
  }

  const normalizedTurns = finalizeTurns(turns).map(reclassifyCursorThinking)
  const summary = summarizeTurns(normalizedTurns)
  const projectDir = file.relativePath.split('/')[0] ?? ''

  return {
    ref: createSessionRef({
      cwd: null,
      homeDirectory: '/',
      idPath: file.relativePath,
      path: file.path,
      project: decodeProjectFromAgentDir(projectDir),
      source: 'cursor',
      startedAt: normalizedTurns[0]?.timestamp ?? null,
      title: summary ?? displayNameFromPath(file.path),
      updatedAt: new Date(file.fingerprint.mtimeMs).toISOString(),
    }),
    cwd: null,
    warnings,
    turns: normalizedTurns,
  }
}

export function createCursorProvider(): SessionCatalogProvider {
  return {
    source: 'cursor',
    scan: async ({ homeDir }) => scanCursorSessions(homeDir),
    index: indexCursorSession,
    load: loadCursorSession,
  }
}

function extractCursorUserText(entry: JsonLineEntry<CursorEntry>): string {
  const joined = extractTextFragments(entry.value?.message?.content).join('\n\n').trim()
  if (!joined) {
    return ''
  }

  return stripOuterTag(joined, 'user_query').trim()
}

function reclassifyCursorThinking(turn: NormalizedTurn): NormalizedTurn {
  if (turn.assistantBlocks.length <= 1) {
    return turn
  }

  return {
    ...turn,
    assistantBlocks: turn.assistantBlocks.map((block, index) => {
      if (index === turn.assistantBlocks.length - 1) {
        return block
      }

      return {
        ...block,
        kind: 'thinking',
      }
    }),
  }
}
