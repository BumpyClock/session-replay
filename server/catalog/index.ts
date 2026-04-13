import { homedir } from 'node:os'
import type {
  MaterializedReplaySession,
  SessionCatalogStatus,
  SessionLoadRequest,
  SessionRef as ApiSessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'
import { toMaterializedReplaySession } from '../../src/lib/session'
import { createClaudeCodeProvider } from '../providers/claude-code'
import { createCodexProvider } from '../providers/codex-provider'
import { createCopilotProvider } from '../providers/copilot'
import { createCursorProvider } from '../providers/cursor'
import { createGeminiProvider } from '../providers/gemini'
import { SessionCatalogService } from './session-catalog-service'
import {
  compareSessionRefs,
  createSearchDocFromSession,
  indexedSessionMatchesQuery,
  matchSessionRefForRequest,
  normalizeSearchText,
} from './search'
import type {
  IndexedSessionEntry,
  NormalizedSession,
  SessionCatalogProvider,
  SessionFileFingerprint,
  SessionFileRef,
  SessionRef,
  SessionSearchDoc,
  SessionWarning,
} from './types'

interface SessionProviderFactoryModule {
  createSessionProvider?: (
    input: { homeDirectory: string },
  ) => Promise<SessionCatalogProvider> | SessionCatalogProvider
  default?:
    | SessionCatalogProvider
    | ((input: { homeDirectory: string }) => Promise<SessionCatalogProvider> | SessionCatalogProvider)
  sessionProvider?: SessionCatalogProvider
}

interface CreateSessionCatalogServiceOptions {
  descriptors?: readonly ProviderDescriptor[]
  homeDirectory?: string
  moduleLoader?: (
    descriptor: Readonly<ProviderDescriptor>,
  ) => Promise<SessionProviderFactoryModule | null>
}

export interface ProviderDescriptor {
  key: string
  modulePath: string
}

export interface SessionSource {
  getCatalogStatus(): SessionCatalogStatus
  listSessions(): Promise<readonly ApiSessionRef[]>
  listCatalogWarnings?(): readonly SessionWarning[]
  refreshSessions(): Promise<readonly ApiSessionRef[]>
  loadSession(request: Readonly<SessionLoadRequest>): Promise<MaterializedReplaySession>
  searchSessions(request: Readonly<SessionSearchRequest>): Promise<readonly ApiSessionRef[]>
}

export function createSessionCatalogService({
  descriptors,
  homeDirectory = homedir(),
  moduleLoader,
}: CreateSessionCatalogServiceOptions = {}): SessionSource {
  let catalog: SessionCatalogService | null = null
  const providersPromise = descriptors
    ? loadSessionProvidersFromDescriptors(descriptors, homeDirectory, moduleLoader)
    : Promise.resolve(createDefaultSessionProviders())
  const catalogPromise = providersPromise.then((providers) => {
    catalog = new SessionCatalogService({ homeDir: homeDirectory, providers })
    return catalog
  })

  const listSessions = async (): Promise<readonly ApiSessionRef[]> => {
    const loadedCatalog = await catalogPromise
    const refs = await loadedCatalog.listSessions()
    return refs.map(toApiRef)
  }

  return {
    getCatalogStatus: () => catalog?.getCatalogStatus() ?? createEmptyCatalogStatus(),
    listSessions,
    listCatalogWarnings: () => catalog?.listCatalogWarnings() ?? [],
    refreshSessions: async () => {
      const loadedCatalog = await catalogPromise
      await loadedCatalog.refresh()
      const refs = await loadedCatalog.listSessions()
      return refs.map(toApiRef)
    },
    loadSession: async (request) => {
      const loadedCatalog = await catalogPromise
      const session = await loadedCatalog.loadSession(request)
      return toMaterializedReplaySession(session)
    },
    searchSessions: async (request) => {
      const loadedCatalog = await catalogPromise
      const refs = await loadedCatalog.searchSessions(request)
      return refs.map(toApiRef)
    },
  }
}

export const createSessionSource = createSessionCatalogService

export { SessionCatalogService }
export {
  compareSessionRefs,
  createSearchDocFromSession,
  indexedSessionMatchesQuery,
  matchSessionRefForRequest,
  normalizeSearchText,
}
export type {
  IndexedSessionEntry,
  NormalizedSession,
  SessionCatalogProvider,
  SessionFileFingerprint,
  SessionFileRef,
  SessionRef,
  SessionSearchDoc,
  SessionWarning,
}

function toApiRef(ref: Readonly<SessionRef>): ApiSessionRef {
  const output: ApiSessionRef = {
    id: ref.id,
    title: ref.title,
    source: ref.source,
    path: ref.path,
  }

  if (ref.project && ref.project !== 'session') {
    output.project = ref.project
  }

  if (ref.startedAt) {
    output.startedAt = ref.startedAt
  }

  if (ref.updatedAt) {
    output.updatedAt = ref.updatedAt
  }

  if (ref.cwd) {
    output.cwd = ref.cwd
  }

  if (ref.summary) {
    output.summary = ref.summary
  }

  if (ref.stats) {
    output.stats = ref.stats
  }

  return output
}

async function loadSessionProvidersFromDescriptors(
  descriptors: readonly ProviderDescriptor[],
  homeDirectory: string,
  moduleLoader?: CreateSessionCatalogServiceOptions['moduleLoader'],
): Promise<SessionCatalogProvider[]> {
  const modules = await Promise.all(
    descriptors.map(async (descriptor) => {
      const loader =
        moduleLoader ??
        (async (loadedDescriptor: Readonly<ProviderDescriptor>) => {
          const pathUrl = new URL(loadedDescriptor.modulePath, import.meta.url)
          return (await import(pathUrl.href)) as SessionProviderFactoryModule
        })

      return await loader(descriptor)
    }),
  )

  const providers: SessionCatalogProvider[] = []

  for (const module of modules) {
    const provider = module ? await pickSessionProvider(module, homeDirectory) : null
    if (provider) {
      providers.push(provider)
    }
  }

  return providers
}

function createDefaultSessionProviders(): SessionCatalogProvider[] {
  return [
    createClaudeCodeProvider(),
    createCodexProvider(),
    createCopilotProvider(),
    createCursorProvider(),
    createGeminiProvider(),
  ]
}

async function pickSessionProvider(
  module: SessionProviderFactoryModule,
  homeDirectory: string,
): Promise<SessionCatalogProvider | null> {
  if (module.createSessionProvider) {
    return await module.createSessionProvider({ homeDirectory })
  }

  if (module.sessionProvider) {
    return module.sessionProvider
  }

  if (typeof module.default === 'function') {
    return await module.default({ homeDirectory })
  }

  if (module.default) {
    return module.default
  }

  return null
}

function createEmptyCatalogStatus(): SessionCatalogStatus {
  return {
    discoveredCount: 0,
    indexedCount: 0,
    pendingCount: 0,
    snapshotAt: new Date(0).toISOString(),
    stale: false,
    state: 'ready',
  }
}
