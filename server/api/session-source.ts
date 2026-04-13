import { homedir } from 'node:os'
import type {
  SessionCatalogStatus,
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'
import type { SessionWarning } from '../../src/lib/session'
import {
  createSessionCatalogService,
  type SessionSource as CatalogSessionSource,
} from '../catalog/index'
import { ApiError } from './errors'

export interface SessionSource {
  getCatalogStatus?(): SessionCatalogStatus
  listSessions(): Promise<readonly SessionRef[]>
  listCatalogWarnings?(): readonly SessionWarning[]
  refreshSessions(): Promise<readonly SessionRef[]>
  loadSession(request: Readonly<SessionLoadRequest>): Promise<MaterializedReplaySession>
  searchSessions(request: Readonly<SessionSearchRequest>): Promise<readonly SessionRef[]>
}

export function createEmptySessionSource(): SessionSource {
  return {
    getCatalogStatus: () => ({
      discoveredCount: 0,
      indexedCount: 0,
      pendingCount: 0,
      snapshotAt: new Date(0).toISOString(),
      stale: false,
      state: 'ready',
    }),
    listSessions: async () => [],
    listCatalogWarnings: () => [],
    refreshSessions: async () => [],
    loadSession: async () => {
      throw new ApiError(404, 'session_not_found', 'Session source is not available')
    },
    searchSessions: async () => [],
  }
}

export async function resolveSessionSource(homeDirectory = homedir()): Promise<SessionSource> {
  return createSessionCatalogService({
    homeDirectory,
  }) satisfies CatalogSessionSource
}
