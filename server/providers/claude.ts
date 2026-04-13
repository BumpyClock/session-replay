import { basename, join, relative } from 'node:path'
import { homedir } from 'node:os'
import { ApiError } from '../api/errors'
import { assertPathInsideHome } from '../api/security'
import { listFilesRecursive, readJsonLines } from '../session-files/index'
import {
  basenameWithoutExtension,
  decodeAgentProjectDirectory,
  normalizePathForId,
} from '../session-files/path-utils'
import type {
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef,
} from '../../src/lib/api/contracts'
import { toMaterializedReplaySession } from '../../src/lib/session/materialize'
import type {
  NormalizedSession,
  SessionSource,
  SessionSourceMeta,
  SessionTextBlockKind,
  SessionWarning,
} from '../../src/lib/session/contracts'

const CLAUDE_SOURCE: SessionSource = 'claude-code'

interface ClaudeJsonLine {
  type?: string
  message?: {
    role?: string
    content?: unknown
  }
  timestamp?: string | null
}

interface ClaudeTextBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface ParsedTurn {
  id: string
  timestamp: string | null
  userText: string
  assistantBlocks: ParsedBlock[]
  toolCalls: ParsedToolCall[]
  sourceMeta: SessionSourceMeta
}

interface ParsedBlock {
  kind: 'text' | 'thinking'
  text: string
  timestamp: string | null
  line: number
}

interface ParsedToolCall {
  id: string
  name: string
  input: unknown
  result: string | null
  isError: boolean
  timestamp: string | null
  resultTimestamp: string | null
  line: number
}

type NormalizedBlock = { block: ParsedBlock; toolCall?: ParsedToolCall }

export async function discoverClaudeSessions(
  homeDirectory = homedir(),
): Promise<readonly SessionRef[]> {
  const basePath = join(homeDirectory, '.claude', 'projects')
  const files = await listFilesRecursive(basePath, (candidate) => candidate.endsWith('.jsonl'))

  return files
    .map((file) => mapSessionFileToRef(file.path, file.updatedAt, basePath))
    .filter((session): session is SessionRef => session !== null)
}

export async function searchClaudeSessions(
  query: string,
  homeDirectory = homedir(),
): Promise<readonly SessionRef[]> {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return []
  }

  const sessions = await discoverClaudeSessions(homeDirectory)
  return sessions.filter((session) =>
    [session.title, session.project ?? '', session.path].some((value) =>
      normalizeQuery(value).includes(normalizedQuery),
    ),
  )
}

export async function loadClaudeSession(
  request: Readonly<SessionLoadRequest>,
  homeDirectory = homedir(),
): Promise<MaterializedReplaySession> {
  const requestedPath = await resolveSessionPath(request, homeDirectory)
  const safePath = assertPathInsideHome(requestedPath, homeDirectory)
  const sessions = await discoverClaudeSessions(homeDirectory)
  const existingRef = sessions.find(
    (session) => normalizePathForId(session.path) === normalizePathForId(safePath),
  )
  const { entries, warnings } = await readJsonLines<ClaudeJsonLine>(safePath)
  const parsed = parseTurns(entries, safePath)

  const fallbackRef: SessionRef = {
    id: normalizePathForId(safePath),
    title: basenameWithoutExtension(safePath),
    source: CLAUDE_SOURCE,
    path: safePath,
    project: deriveProjectNameFromPath(homeDirectory, safePath),
    startedAt: entries[0]?.value?.timestamp ?? null,
    updatedAt: null,
    cwd: null,
    summary: undefined,
    stats: undefined,
  }

  const normalizedSession: NormalizedSession = {
    ref: existingRef ?? fallbackRef,
    cwd: null,
    warnings: warnings.map((warning): SessionWarning => ({
      code: warning.code,
      message: warning.message,
      filePath: warning.filePath,
      line: warning.line,
    })),
    turns: parsed.map((turn, index) => ({
      id: turn.id,
      index: index + 1,
      role: 'turn' as const,
      timestamp: turn.timestamp,
      userText: turn.userText,
      assistantBlocks: turn.assistantBlocks.map((block, blockIndex) => ({
        id: `${turn.id}:block:${blockIndex}`,
        kind: block.kind,
        text: block.text,
        timestamp: block.timestamp ?? undefined,
        sourceMeta: {
          provider: CLAUDE_SOURCE,
          filePath: safePath,
          lineStart: block.line,
          lineEnd: block.line,
          eventIds: [String(blockIndex)],
          rawTypes: [block.kind as SessionTextBlockKind],
        },
      })),
      toolCalls: turn.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
        result: toolCall.result,
        isError: toolCall.isError,
        timestamp: toolCall.timestamp,
        resultTimestamp: toolCall.resultTimestamp,
        sourceMeta: {
          provider: CLAUDE_SOURCE,
          filePath: safePath,
          lineStart: toolCall.line,
          lineEnd: toolCall.line,
          eventIds: [toolCall.id],
          rawTypes: ['tool_use'],
        },
      })),
      sourceMeta: turn.sourceMeta,
    })),
  }

  return toMaterializedReplaySession(normalizedSession)
}

function mapSessionFileToRef(
  path: string,
  updatedAt: string | null,
  basePath: string,
): SessionRef | null {
  const relativePath = normalizePathForId(relative(basePath, path))
  const projectSegment = relativePath.split('/')[0] ?? ''
  if (!projectSegment) {
    return null
  }

  return {
    id: normalizePathForId(path),
    title: basenameWithoutExtension(path),
    source: CLAUDE_SOURCE,
    path,
    project: deriveProjectName(projectSegment),
    startedAt: updatedAt,
    updatedAt,
    cwd: null,
    summary: undefined,
    stats: undefined,
  }
}

async function resolveSessionPath(
  request: Readonly<SessionLoadRequest>,
  homeDirectory: string,
): Promise<string> {
  if (request.path) {
    return request.path
  }

  const sessionId = request.sessionId?.trim()
  if (!sessionId) {
    throw new ApiError(400, 'invalid_request', 'Load request requires a path or sessionId')
  }

  const sessions = await discoverClaudeSessions(homeDirectory)
  const byId = sessions.find(
    (session) =>
      normalizePathForId(session.id) === normalizePathForId(sessionId) ||
      normalizePathForId(session.path) === normalizePathForId(sessionId),
  )
  if (byId) {
    return byId.path
  }

  const byFilename = sessions.find(
    (session) => basename(session.path) === sessionId || basenameWithoutExtension(session.path) === sessionId,
  )
  if (byFilename) {
    return byFilename.path
  }

  const candidateFile = sessionId.endsWith('.jsonl') ? sessionId : `${sessionId}.jsonl`
  const baseMatch = sessions.find(
    (session) =>
      basename(session.path) === candidateFile ||
      basenameWithoutExtension(session.path) === basenameWithoutExtension(candidateFile),
  )
  if (baseMatch) {
    return baseMatch.path
  }

  throw new ApiError(404, 'session_not_found', `Claude session not found: ${sessionId}`)
}

function parseTurns(
  entries: { line: number; value: ClaudeJsonLine }[],
  filePath: string,
): ParsedTurn[] {
  const turns: ParsedTurn[] = []
  let index = 0
  let turnCounter = 0

  while (index < entries.length) {
    const entry = entries[index]
    const role = parseRole(entry.value)
    if (role === 'user') {
      let userText = extractTextFromContent(entry.value.message?.content)
      if (isToolResultOnly(entry.value.message?.content)) {
        index += 1
        continue
      }

      const turnId = `claude-turn-${turnCounter + 1}`
  const turnStartLine = entry.line
      let turnEndLine = entry.line
  const turnTimestamp = normalizeTimestamp(entry.value.timestamp)
      index += 1

      while (index < entries.length) {
        const nextEntry = entries[index]
        const nextRole = parseRole(nextEntry.value)
        if (nextRole !== 'user') {
          break
        }
        const nextContent = nextEntry.value.message?.content
        if (isToolResultOnly(nextContent)) {
          break
        }
        const nextText = extractTextFromContent(nextContent)
        if (nextText) {
          userText = userText ? `${userText}\n${nextText}` : nextText
        }
        turnEndLine = nextEntry.line
        index += 1
      }

      const [assistantParsed, nextIndex] = collectAssistantBlocks(entries, index)
      index = attachToolResults(assistantParsed, entries, nextIndex)

      const cleanedText = extractSystemTags(userText)
      const blocks = assistantParsed.flatMap((item) =>
        item.toolCall ? [] : [item.block],
      )
      const toolCalls = assistantParsed.flatMap((item) => (item.toolCall ? [item.toolCall] : []))

      const normalizedBlocks = blocks
      const normalizedToolCalls = toolCalls.map((toolCall, toolIndex) => ({
        ...toolCall,
        id: `${turnId}:tool:${toolIndex}`,
        line: toolCall.line || turnEndLine,
      }))

      const sourceMeta: SessionSourceMeta = {
        provider: CLAUDE_SOURCE,
        filePath,
        lineStart: turnStartLine,
        lineEnd:
          Math.max(
            turnEndLine,
            ...normalizedBlocks.map((block) => block.line),
            ...normalizedToolCalls.map((tool) => tool.line),
          ) || turnEndLine,
        eventIds: [`${turnId}`],
        rawTypes: ['user', 'assistant'],
      }

      if (normalizedBlocks.length > 0 || normalizedToolCalls.length > 0 || cleanedText) {
        turnCounter += 1
        turns.push({
          id: `claude-turn-${turnCounter}`,
          timestamp: turnTimestamp,
          userText: cleanedText,
          assistantBlocks: normalizedBlocks,
          toolCalls: normalizedToolCalls,
          sourceMeta,
        })
      }

      continue
    }

    if (role === 'assistant') {
      const turnId = `claude-turn-${turnCounter + 1}`
      const [assistantParsed, nextIndex] = collectAssistantBlocks(entries, index)
      index = attachToolResults(assistantParsed, entries, nextIndex)
      const blocks = assistantParsed.flatMap((item) =>
        item.toolCall ? [] : [item.block],
      )
      const toolCalls = assistantParsed.flatMap((item) => (item.toolCall ? [item.toolCall] : []))

      const normalizedToolCalls = toolCalls.map((toolCall, toolIndex) => ({
        ...toolCall,
        id: `${turnId}:tool:${toolIndex}`,
        line: toolCall.line || entry.line,
      }))

      const sourceMeta: SessionSourceMeta = {
        provider: CLAUDE_SOURCE,
        filePath,
        lineStart: entry.line,
        lineEnd: Math.max(entry.line, ...blocks.map((block) => block.line), ...normalizedToolCalls.map((tool) => tool.line)),
        eventIds: [`${turnId}`],
        rawTypes: ['assistant'],
      }

      if (blocks.length > 0 || normalizedToolCalls.length > 0) {
        if (turns.length > 0) {
          const lastTurn = turns[turns.length - 1]
          lastTurn.assistantBlocks.push(...blocks)
          lastTurn.toolCalls.push(...normalizedToolCalls)
          lastTurn.sourceMeta.lineEnd = Math.max(lastTurn.sourceMeta.lineEnd, sourceMeta.lineEnd)
        } else {
          turnCounter += 1
          turns.push({
            id: `claude-turn-${turnCounter}`,
            timestamp: normalizeTimestamp(entry.value.timestamp),
            userText: '',
            assistantBlocks: blocks,
            toolCalls: normalizedToolCalls,
            sourceMeta,
          })
        }
      }

      continue
    }

    index += 1
  }

  return turns
}

function collectAssistantBlocks(
  entries: { line: number; value: ClaudeJsonLine }[],
  start: number,
): [NormalizedBlock[], number] {
  const blocks: NormalizedBlock[] = []
  const seen = new Set<string>()
  let cursor = start

  while (cursor < entries.length) {
    const entry = entries[cursor]
    const role = parseRole(entry.value)
    if (role !== 'assistant') {
      break
    }

    const timestamp = normalizeTimestamp(entry.value.timestamp)
    const content = entry.value.message?.content
    if (Array.isArray(content)) {
      for (const rawBlock of content as ClaudeTextBlock[]) {
        const blockType = rawBlock.type
        if (blockType === 'text') {
          const text = String(rawBlock.text ?? '').trim()
          if (!text || text === 'No response requested.') {
            continue
          }
          const key = `text:${text}`
          if (seen.has(key)) {
            continue
          }
          seen.add(key)
          blocks.push({
            block: {
              kind: 'text',
              text,
              timestamp,
              line: entry.line,
            },
          })
          continue
        }

        if (blockType === 'thinking') {
          const text = String(rawBlock.thinking ?? '').trim()
          if (!text) {
            continue
          }
          const key = `thinking:${text}`
          if (seen.has(key)) {
            continue
          }
          seen.add(key)
          blocks.push({
            block: {
              kind: 'thinking',
              text,
              timestamp,
              line: entry.line,
            },
          })
          continue
        }

        if (blockType === 'tool_use') {
          const toolUseId = String(rawBlock.id ?? '').trim()
          const toolKey = `tool_use:${toolUseId}`
          if (seen.has(toolKey)) {
            continue
          }
          seen.add(toolKey)
          blocks.push({
            block: {
              kind: 'text',
              text: '',
              timestamp,
              line: entry.line,
            },
            toolCall: {
              id: toolUseId || `tool-${entry.line}`,
              name: String(rawBlock.name ?? ''),
              input: rawBlock.input ?? {},
              result: null,
              isError: false,
              timestamp,
              resultTimestamp: null,
              line: entry.line,
            },
          })
        }
      }
    }

    cursor += 1
  }

  return [blocks, cursor]
}

function attachToolResults(
  blocks: NormalizedBlock[],
  entries: { line: number; value: ClaudeJsonLine }[],
  start: number,
): number {
  const resolvedCalls = new Map<string, ParsedToolCall>()

  for (const { toolCall } of blocks) {
    if (!toolCall) {
      continue
    }

    resolvedCalls.set(toolCall.id, {
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      result: toolCall.result,
      isError: toolCall.isError,
      timestamp: toolCall.timestamp,
      resultTimestamp: toolCall.resultTimestamp,
      line: toolCall.line,
    })
  }

  if (resolvedCalls.size === 0) {
    return start
  }

  let cursor = start
  while (cursor < entries.length) {
    const entry = entries[cursor]
    const role = parseRole(entry.value)
    if (role === 'assistant') {
      break
    }

    if (role === 'user') {
      const content = entry.value.message?.content
      if (!Array.isArray(content)) {
        break
      }

      let hasToolResult = false
      for (const rawBlock of content as ClaudeTextBlock[]) {
        if (rawBlock.type !== 'tool_result') {
          continue
        }
        hasToolResult = true
        const toolUseId = String(rawBlock.tool_use_id ?? '')
        const pendingCall = resolvedCalls.get(toolUseId)
        if (!pendingCall) {
          continue
        }
        pendingCall.result = extractToolResultText(rawBlock.content)
          .replace(/^<tool_use_error>([\s\S]*)<\/tool_use_error>$/, '$1')
        pendingCall.isError = !!rawBlock.is_error
        pendingCall.resultTimestamp = normalizeTimestamp(entry.value.timestamp)
      }

      if (!hasToolResult) {
        break
      }
    }

    cursor += 1
  }

  for (let cursorBlock = 0; cursorBlock < blocks.length; cursorBlock++) {
    const block = blocks[cursorBlock]
    if (!block.toolCall) {
      continue
    }
    const resolved = resolvedCalls.get(block.toolCall.id)
    if (resolved) {
      blocks[cursorBlock] = {
        ...block,
        toolCall: {
          ...block.toolCall,
          result: resolved.result,
          isError: resolved.isError,
          resultTimestamp: resolved.resultTimestamp,
          line: resolved.line,
        },
      }
    }
  }

  return cursor
}

function parseRole(entry: ClaudeJsonLine): string | null {
  const role = entry.type ?? entry.message?.role
  return role === 'user' || role === 'assistant' ? role : null
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return extractSystemTags(content)
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return cleanSystemTags(
    content
      .filter((part) => part && typeof part === 'object' && part.type === 'text')
      .map((part) => String(part?.text ?? ''))
      .join('\n'),
  )
}

function isToolResultOnly(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false
  }

  return content.every((part) => part?.type === 'tool_result')
}

function extractToolResultText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text')
      .map((part) => String(part?.text ?? ''))
      .join('\n')
  }
  if (typeof content === 'string') {
    return content
  }
  return String(content)
}

function extractSystemTags(text: string): string {
  const { cleanedText } = stripSystemTags(text)
  return cleanedText
}

function stripSystemTags(text: string): { systemEvents: string[]; cleanedText: string } {
  const events: string[] = []
  const cleaned = text
    .replace(
      /<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g,
      (_, _status, summary) => {
        events.push(summary)
        return `[bg-task: ${summary}]`
      },
    )
    .replace(/\n*Read the output file to retrieve the result:[^\n]*/g, '')
    .replace(/<user_query>([\s\S]*?)<\/user_query>\s*/g, (_, inner) => inner.trim())
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>\s*/g, (_, name) => `${name.trim()}\n`)
    .replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, '')
    .replace(/<command-args>\s*<\/command-args>\s*/g, '')
    .replace(/<command-args>([\s\S]*?)<\/command-args>\s*/g, (_, args) => {
      const trimmed = String(args).trim()
      return trimmed ? `${trimmed}\n` : ''
    })
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/g, '')
    .trim()

  return { systemEvents: events, cleanedText: cleaned }
}

function deriveProjectName(input: string): string {
  const decoded = decodeAgentProjectDirectory(input)
  if (decoded) {
    return decoded
  }

  return input || 'claude-project'
}

function deriveProjectNameFromPath(homeDirectory: string, sessionPath: string): string {
  const basePath = join(homeDirectory, '.claude', 'projects')
  const relativePath = normalizePathForId(relative(basePath, sessionPath))
  const projectSegment = relativePath.split('/')[0] ?? ''
  return deriveProjectName(projectSegment)
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  return value
}
