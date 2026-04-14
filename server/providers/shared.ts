import { basename, relative } from 'node:path'
import type {
  IndexedSessionEntry,
  NormalizedTurn,
  NormalizedSession,
  SessionAssistantBlock,
  SessionFileRef,
  SessionFileFingerprint,
  SessionRef,
  SessionSource,
  SessionSourceMeta,
  SessionTextBlock,
  SessionToolCall,
} from '../../src/lib/session/contracts.js'
import { createSessionStats, summarizeNormalizedSession } from '../../src/lib/session/materialize.js'
import { createSearchDocFromSession } from '../catalog/search.js'
import type { SessionFileRecord } from '../session-files/filesystem.js'
import {
  basenameWithoutExtension,
  decodeAgentProjectDirectory,
  lastPathSegment,
  normalizePathForId,
} from '../session-files/index.js'

interface CreateSessionRefInput {
  cwd?: string | null
  homeDirectory: string
  idPath?: string
  path: string
  project: string
  source: SessionSource
  startedAt?: string | null
  title?: string | null
  updatedAt?: string | null
}

interface CreateTurnInput {
  filePath: string
  id: string
  index: number
  provider: SessionSource
  timestamp?: string | null
  userText: string
}

export function createSessionRef(input: CreateSessionRefInput): SessionRef {
  const title = truncateText(input.title?.trim() || basenameWithoutExtension(input.path), 96)
  const idPath = normalizePathForId(input.idPath ?? relative(input.homeDirectory, input.path))

  return {
    id: `${input.source}:${idPath}`,
    path: input.path,
    source: input.source,
    project: input.project,
    title,
    startedAt: input.startedAt ?? null,
    updatedAt: input.updatedAt ?? null,
    cwd: input.cwd ?? null,
  }
}

export function createTurn(input: CreateTurnInput): NormalizedTurn {
  return {
    id: input.id,
    index: input.index,
    role: 'turn',
    timestamp: input.timestamp ?? null,
    userText: input.userText.trim(),
    assistantBlocks: [],
    sourceMeta: createSourceMeta({
      filePath: input.filePath,
      provider: input.provider,
    }),
  }
}

export function createSourceMeta(input: {
  eventIds?: string[]
  filePath: string
  lineEnd?: number
  lineStart?: number
  provider: SessionSource
  rawTypes?: string[]
}): SessionSourceMeta {
  return {
    provider: input.provider,
    filePath: input.filePath,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    eventIds: input.eventIds,
    rawTypes: input.rawTypes,
  }
}

export function createTextBlock(input: {
  filePath: string
  id: string
  kind: SessionTextBlock['kind']
  provider: SessionSource
  text: string
  timestamp?: string | null
  line?: number
  rawTypes?: string[]
}): SessionTextBlock | null {
  const text = normalizeWhitespace(input.text)
  if (!text) {
    return null
  }

  return {
    id: input.id,
    kind: input.kind,
    text,
    timestamp: input.timestamp ?? null,
    sourceMeta: createSourceMeta({
      filePath: input.filePath,
      lineStart: input.line,
      lineEnd: input.line,
      provider: input.provider,
      rawTypes: input.rawTypes,
    }),
  }
}

export function createToolCall(input: {
  filePath: string
  id: string
  input?: unknown
  isError?: boolean
  name: string
  provider: SessionSource
  result?: string | null
  resultTimestamp?: string | null
  timestamp?: string | null
  line?: number
  rawTypes?: string[]
}): SessionToolCall {
  return {
    id: input.id,
    kind: 'tool-call',
    name: input.name,
    input: input.input ?? null,
    result: input.result ? normalizeWhitespace(input.result) : null,
    isError: input.isError ?? false,
    timestamp: input.timestamp ?? null,
    resultTimestamp: input.resultTimestamp ?? null,
    sourceMeta: createSourceMeta({
      filePath: input.filePath,
      lineStart: input.line,
      lineEnd: input.line,
      provider: input.provider,
      rawTypes: input.rawTypes,
    }),
  }
}

export function appendTurnLine(turn: NormalizedTurn, line?: number): void {
  if (line === undefined) {
    return
  }

  if (turn.sourceMeta.lineStart === undefined || line < turn.sourceMeta.lineStart) {
    turn.sourceMeta.lineStart = line
  }

  if (turn.sourceMeta.lineEnd === undefined || line > turn.sourceMeta.lineEnd) {
    turn.sourceMeta.lineEnd = line
  }
}

export function finalizeTurns(turns: NormalizedTurn[]): NormalizedTurn[] {
  return turns
    .filter((turn) => {
      return Boolean(
        turn.userText ||
          turn.assistantBlocks.length > 0,
      )
    })
    .map((turn, index) => ({
      ...turn,
      index,
    }))
}

export function summarizeTurns(turns: readonly NormalizedTurn[]): string | null {
  for (const turn of turns) {
    const text = normalizeWhitespace(turn.userText)
    if (text) {
      return truncateText(text, 96)
    }
  }

  return null
}

export function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim()
}

export function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

export function decodeProjectFromAgentDir(dirName: string): string {
  const decoded = decodeAgentProjectDirectory(dirName)
  if (decoded) {
    const parts = decoded.replaceAll('\\', '/').split('/').filter(Boolean)
    if (parts.length === 1) {
      return parts[0]
    }

    if (parts.length >= 2) {
      return parts.slice(-2).join('-')
    }
  }

  return lastPathSegment(dirName) ?? dirName
}

export function pathProjectName(value: string | null | undefined, fallback: string): string {
  return lastPathSegment(value) ?? fallback
}

export function stripTagContent(value: string, tagName: string): string {
  return value.replace(
    new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`, 'giu'),
    '',
  )
}

export function stripOuterTag(value: string, tagName: string): string {
  return value
    .replace(new RegExp(`^\\s*<${tagName}>\\s*`, 'iu'), '')
    .replace(new RegExp(`\\s*<\\/${tagName}>\\s*$`, 'iu'), '')
}

export function extractTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = normalizeWhitespace(value)
    return text ? [text] : []
  }

  if (!Array.isArray(value)) {
    return []
  }

  const fragments: string[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const text =
      typeof record.text === 'string'
        ? record.text
        : typeof record.content === 'string'
          ? record.content
          : null

    if (text) {
      const normalized = normalizeWhitespace(text)
      if (normalized) {
        fragments.push(normalized)
      }
    }
  }

  return fragments
}

export function stringifyData(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }

  if (typeof value === 'string') {
    const text = normalizeWhitespace(value)
    return text || undefined
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function toolResultText(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizeWhitespace(value) || null
  }

  if (Array.isArray(value)) {
    const parts = value
      .flatMap((item) => {
        if (typeof item === 'string') {
          return normalizeWhitespace(item)
        }

        if (!item || typeof item !== 'object') {
          return ''
        }

        const record = item as Record<string, unknown>
        if (typeof record.text === 'string') {
          return normalizeWhitespace(record.text)
        }

        if (typeof record.content === 'string') {
          return normalizeWhitespace(record.content)
        }

        return ''
      })
      .filter(Boolean)

    return parts.length > 0 ? parts.join('\n\n') : null
  }

  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  return null
}

export function attachToolResult(
  assistantBlocks: SessionAssistantBlock[],
  toolId: string,
  result: string | null,
  options: {
    isError?: boolean
    resultTimestamp?: string | null
  } = {},
): boolean {
  let matched = false

  for (const block of [...assistantBlocks].reverse()) {
    if (block.kind !== 'tool-call') {
      continue
    }

    const toolCall = block
    if (toolCall.id !== toolId && !toolCall.id.startsWith(`${toolId}:`)) {
      continue
    }

    toolCall.result = result
    toolCall.resultTimestamp = options.resultTimestamp ?? toolCall.resultTimestamp
    toolCall.isError = options.isError ?? toolCall.isError
    matched = true
  }

  return matched
}

export function displayNameFromPath(filePath: string): string {
  return basenameWithoutExtension(filePath) || basename(filePath)
}

export function createSessionFileFingerprint(file: Readonly<SessionFileRecord>): SessionFileFingerprint {
  return {
    path: file.path,
    mtimeMs: file.mtimeMs,
    size: file.size,
  }
}

export function createSessionFileRef(
  source: SessionSource,
  file: Readonly<SessionFileRecord>,
): SessionFileRef {
  return {
    source,
    path: file.path,
    relativePath: file.relativePath,
    fingerprint: createSessionFileFingerprint(file),
  }
}

export function createIndexedSessionEntry(
  file: Readonly<SessionFileRef>,
  session: Readonly<NormalizedSession>,
): IndexedSessionEntry {
  const ref: SessionRef = {
    ...session.ref,
    summary: summarizeNormalizedSession(session),
    stats: createSessionStats(session),
  }

  return {
    file: {
      ...file,
    },
    ref,
    searchDoc: createSearchDocFromSession(ref, session),
    warnings: [...session.warnings],
  }
}
