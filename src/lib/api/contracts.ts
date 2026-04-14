import type { SessionWarning } from '../session/contracts'

/**
 * Current immutable catalog snapshot.
 * Counts reflect discovery/index progress for all scanned provider roots.
 */
export interface SessionCatalogStatus {
  discoveredCount: number
  indexedCount: number
  pendingCount: number
  snapshotAt: string
  stale: boolean
  state: 'indexing' | 'ready' | 'refreshing'
}

/**
 * Lightweight metadata for a discovered transcript session.
 */
export interface SessionRef {
  id: string
  title: string
  source: string
  path: string
  project?: string
  cwd?: string
  startedAt?: string
  updatedAt?: string
  summary?: string
  stats?: SessionStats
}

/**
 * Aggregate counters shown in session lists and viewer headers.
 */
export interface SessionStats {
  turnCount: number
  userTurnCount?: number
  assistantTurnCount?: number
  toolCallCount?: number
}

/**
 * Supported logical roles in normalized replay turns.
 */
export type ReplayRole = 'assistant' | 'system' | 'tool' | 'user'

/**
 * Renderable transcript text block.
 * `title` and `language` are optional display hints for code/markdown renderers.
 */
export interface ReplayTextBlock {
  id: string
  type: 'code' | 'json' | 'markdown' | 'text' | 'thinking'
  text: string
  language?: string
  title?: string
}

/**
 * Structured tool invocation captured from transcript content.
 * `input` stays structured so replay renderers can produce file-aware previews,
 * diffs, and richer tool summaries without reparsing stringified payloads.
 */
export interface ReplayToolBlock {
  id: string
  type: 'tool'
  name: string
  status?: 'completed' | 'failed' | 'running'
  input?: unknown
  output?: string
  isError?: boolean
  timestamp?: string
  resultTimestamp?: string
  title?: string
}

/**
 * Renderable unit inside a replay turn.
 */
export type ReplayBlock = ReplayTextBlock | ReplayToolBlock

/**
 * Bookmark jump target inside a replay session.
 */
export interface ReplayBookmark {
  id: string
  label: string
  turnIndex: number
}

/**
 * Client-materialized replay payload rendered by preview/export endpoints.
 */
export interface MaterializedReplaySession {
  id: string
  title: string
  source: string
  project?: string
  cwd?: string
  summary?: string
  description?: string
  startedAt?: string
  updatedAt?: string
  stats?: SessionStats
  bookmarks?: ReplayBookmark[]
  turns: ReplayTurn[]
}

/**
 * One renderable turn in the exported viewer.
 */
export interface ReplayTurn {
  id: string
  index: number
  role: ReplayRole
  label?: string
  timestamp?: string
  included?: boolean
  blocks: ReplayBlock[]
}

/**
 * Viewer-only render options for preview/export.
 */
export interface ReplayRenderOptions {
  autoplayDelayMs?: number
  exportTitle?: string
  /** Drop thinking blocks entirely when false. */
  includeThinking?: boolean
  /** Drop tool blocks entirely when false. */
  includeToolCalls?: boolean
  /** Prefer this visible replay turn after filtering. */
  initialTurnIndex?: number
  /** Remove session/turn timestamps from rendered output when false. */
  keepTimestamps?: boolean
  /** Keep thinking blocks in output but hide them by default when false. */
  revealThinking?: boolean
}

/**
 * Response envelope for discovered sessions.
 */
export interface SessionListResponse {
  catalog?: SessionCatalogStatus
  sessions: SessionRef[]
  warnings?: SessionWarning[]
}

/**
 * Request body for loading one normalized session.
 */
export interface SessionLoadRequest {
  path?: string
  sessionId?: string
}

/**
 * Response envelope for a loaded normalized session.
 */
export interface SessionLoadResponse {
  session: MaterializedReplaySession
}

/**
 * Request body for searching discovered sessions.
 */
export interface SessionSearchRequest {
  limit?: number
  query: string
}

/**
 * Response envelope for search hits.
 */
export interface SessionSearchResponse {
  results: SessionRef[]
}

/**
 * Shared body shape for preview and export rendering.
 */
export interface SessionRenderRequest {
  options?: ReplayRenderOptions
  session: MaterializedReplaySession
}

/**
 * JSON preview response with iframe-ready HTML.
 */
export interface SessionPreviewResponse {
  html: string
}

/**
 * Stable API error envelope.
 */
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
