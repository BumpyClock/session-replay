import type { SessionWarning } from '../session/contracts'
import type {
  MaterializedReplaySession,
  SessionStats,
} from './schemas'

export type {
  MaterializedReplaySession,
  ReplayBlock,
  ReplayBookmark,
  ReplayRenderOptions,
  ReplayRole,
  ReplayTextBlock,
  ReplayToolBlock,
  ReplayTurn,
  SessionLoadRequest,
  SessionRenderRequest,
  SessionSearchRequest,
  SessionStats,
} from './schemas'

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
/**
 * Response envelope for a loaded normalized session.
 */
export interface SessionLoadResponse {
  session: MaterializedReplaySession
}

/**
 * Request body for searching discovered sessions.
 */
/**
 * Response envelope for search hits.
 */
export interface SessionSearchResponse {
  results: SessionRef[]
}

/**
 * Request body for rendering the one-file export document.
 */
/**
 * Stable API error envelope.
 */
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
  }
}
