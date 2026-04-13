import { homedir } from 'node:os'
import type {
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'
import {
  createSessionCatalogService,
  type SessionSource as CatalogSessionSource,
} from '../catalog/index'
import { ApiError } from './errors'

export interface SessionSource {
  listSessions(): Promise<readonly SessionRef[]>
  refreshSessions(): Promise<readonly SessionRef[]>
  loadSession(request: Readonly<SessionLoadRequest>): Promise<MaterializedReplaySession>
  searchSessions(request: Readonly<SessionSearchRequest>): Promise<readonly SessionRef[]>
}

export function createEmptySessionSource(): SessionSource {
  return {
    listSessions: async () => [],
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
