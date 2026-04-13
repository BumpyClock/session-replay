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

export function createCursorProvider(): SessionProvider {
  return {
    source: 'cursor',
    discover: async ({ homeDir }) => {
      const rootPath = join(homeDir, '.cursor', 'projects')
      const files = await listFilesRecursive(rootPath, (filePath) => {
        if (!filePath.endsWith('.jsonl')) {
          return false
        }

        return filePath.includes('/agent-transcripts/') || filePath.includes('\\agent-transcripts\\')
      })

      const refs: SessionRef[] = []
      for (const file of files) {
        const relativeParts = file.relativePath.split('/')
        const projectDir = relativeParts[0] ?? ''

        if (!relativeParts.includes('agent-transcripts')) {
          continue
        }

        const session = await loadCursorSession({
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
      return loadCursorSession({
        filePath: ref.path,
        homeDirectory: '',
        project: ref.project,
        updatedAt: ref.updatedAt,
      })
    },
  }
}

async function loadCursorSession(input: {
  filePath: string
  homeDirectory: string
  project: string
  updatedAt?: string | null
}): Promise<NormalizedSession> {
  const { entries, warnings } = await readJsonLines<CursorEntry>(input.filePath)
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
        filePath: input.filePath,
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
        filePath: input.filePath,
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
        filePath: input.filePath,
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

  return {
    ref: createSessionRef({
      cwd: null,
      homeDirectory: input.homeDirectory || '/',
      path: input.filePath,
      project: input.project,
      source: 'cursor',
      startedAt: normalizedTurns[0]?.timestamp ?? null,
      title: summary ?? displayNameFromPath(input.filePath),
      updatedAt: input.updatedAt ?? null,
    }),
    cwd: null,
    warnings,
    turns: normalizedTurns,
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
