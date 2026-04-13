import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type {
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'
import { ApiError } from './errors'

/**
 * Readonly session provider bridge implemented by provider-specific workers.
 */
export interface SessionSource {
  listSessions(): Promise<readonly SessionRef[]>
  loadSession(request: Readonly<SessionLoadRequest>): Promise<MaterializedReplaySession>
  searchSessions(request: Readonly<SessionSearchRequest>): Promise<readonly SessionRef[]>
}

interface SessionSourceFactoryModule {
  createSessionSource?: (input: { homeDirectory: string }) => Promise<SessionSource> | SessionSource
  default?: SessionSource | ((input: { homeDirectory: string }) => Promise<SessionSource> | SessionSource)
  sessionSource?: SessionSource
}

/**
 * Empty default until provider adapters register a real session source.
 */
export function createEmptySessionSource(): SessionSource {
  return {
    listSessions: async () => [],
    loadSession: async () => {
      throw new ApiError(404, 'session_not_found', 'Session source is not available')
    },
    searchSessions: async () => [],
  }
}

/**
 * Best-effort bridge for future provider modules without hard compile-time coupling.
 */
export async function resolveSessionSource(homeDirectory = homedir()): Promise<SessionSource> {
  const modulePaths = [
    new URL('../providers/index.ts', import.meta.url),
    new URL('../providers/index.js', import.meta.url),
  ]

  for (const modulePath of modulePaths) {
    try {
      await access(modulePath)
      const module = (await import(pathToFileURL(modulePath.pathname).href)) as SessionSourceFactoryModule
      const sessionSource = await pickSessionSource(module, homeDirectory)

      if (sessionSource) {
        return sessionSource
      }
    } catch {
      continue
    }
  }

  return createEmptySessionSource()
}

async function pickSessionSource(
  module: SessionSourceFactoryModule,
  homeDirectory: string,
): Promise<SessionSource | null> {
  if (module.createSessionSource) {
    return await module.createSessionSource({ homeDirectory })
  }

  if (module.sessionSource) {
    return module.sessionSource
  }

  if (typeof module.default === 'function') {
    return await module.default({ homeDirectory })
  }

  if (module.default) {
    return module.default
  }

  return null
}
