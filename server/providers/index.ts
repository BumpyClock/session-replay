import { basename } from 'node:path'
import { homedir } from 'node:os'
import { ApiError } from '../api/errors'
import { sessionMatchesQuery } from '../../src/lib/session'
import { toMaterializedReplaySession } from '../../src/lib/session/materialize'
import type {
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef as ApiSessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'
import { basenameWithoutExtension, normalizePathForId } from '../session-files/path-utils'
import type {
  SessionProvider,
  SessionRef as CanonicalSessionRef,
} from '../../src/lib/session/contracts'
import { createClaudeCodeProvider } from './claude-code'
import { createCodexProvider } from './codex-provider'
import { createCopilotProvider } from './copilot'
import { createCursorProvider } from './cursor'
import { createGeminiProvider } from './gemini'

interface ProviderSessionSource {
  listSessions(): Promise<readonly ApiSessionRef[]>
  loadSession(request: Readonly<SessionLoadRequest>): Promise<MaterializedReplaySession>
  searchSessions(request: Readonly<SessionSearchRequest>): Promise<readonly ApiSessionRef[]>
}

interface ProviderSourceAdapter {
  discover: () => Promise<readonly CanonicalSessionRef[]>
  load: (ref: Readonly<CanonicalSessionRef>) => Promise<MaterializedReplaySession>
  search: (request: Readonly<SessionSearchRequest>) => Promise<readonly CanonicalSessionRef[]>
}

interface SessionSourceFactoryModule {
  createSessionSource?: (input: { homeDirectory: string }) => Promise<ProviderSessionSource> | ProviderSessionSource
  default?: ProviderSessionSource | ((input: { homeDirectory: string }) => Promise<ProviderSessionSource> | ProviderSessionSource)
  sessionSource?: ProviderSessionSource
}

interface CreateSessionSourceOptions {
  descriptors?: readonly ProviderDescriptor[]
  homeDirectory?: string
  moduleLoader?: (
    descriptor: Readonly<ProviderDescriptor>,
  ) => Promise<SessionSourceFactoryModule | null>
}

export interface ProviderDescriptor {
  key: string
  modulePath: string
}

export interface SessionSource {
  listSessions(): Promise<readonly ApiSessionRef[]>
  loadSession(request: Readonly<SessionLoadRequest>): Promise<MaterializedReplaySession>
  searchSessions(request: Readonly<SessionSearchRequest>): Promise<readonly ApiSessionRef[]>
}

export function createSessionSource({
  descriptors,
  homeDirectory = homedir(),
  moduleLoader,
}: CreateSessionSourceOptions = {}): SessionSource {
  const sourcesPromise = descriptors
    ? loadSessionSourcesFromDescriptors(descriptors, homeDirectory, moduleLoader)
    : Promise.resolve(createDefaultSessionSources(homeDirectory))

  const getSources = async () => sourcesPromise

  return {
    listSessions: async () => {
      const sources = await getSources()
      const grouped = await Promise.all(
        sources.map((provider) => provider.discover().then((items) => ({ items }))),
      )
      const refs = grouped.flatMap(({ items }) => items)

      return refs
        .sort(compareSessionRefs)
        .map((ref) => toApiRef(ref))
    },
    loadSession: async (request) => {
      const sources = await getSources()
      const discovered: Array<{ provider: ProviderSourceAdapter; ref: CanonicalSessionRef }> = []

      for (const provider of sources) {
        const refs = await provider.discover()
        for (const ref of refs) {
          discovered.push({ provider, ref })
        }
      }

      const match = resolveSessionRefForRequest(discovered.map(({ ref }) => ref), request)
      if (!match) {
        throw new ApiError(404, 'session_not_found', 'Session not found')
      }

      const handler = discovered.find((entry) => entry.ref.path === match.path)
      if (!handler) {
        throw new ApiError(404, 'session_not_found', 'Session not found')
      }

      return handler.provider.load(match)
    },
    searchSessions: async (request) => {
      const query = normalizeQuery(request.query)
      if (!query) {
        return []
      }

      const sources = await getSources()
      const searchGroups = await Promise.all(
        sources.map((provider) => provider.search({ ...request, query })),
      )
      const collected: CanonicalSessionRef[] = []
      const seen = new Set<string>()

      for (const group of searchGroups) {
        for (const ref of group) {
          const key = `${ref.source}:${ref.path}`
          if (seen.has(key)) {
            continue
          }
          seen.add(key)
          collected.push(ref)
        }
      }

      const sorted = collected.sort(compareSessionRefs)
      const limited =
        typeof request.limit === 'number' ? sorted.slice(0, request.limit) : sorted

      return limited.map((ref) => toApiRef(ref))
    },
  }
}

function compareSessionRefs(
  left: Readonly<CanonicalSessionRef>,
  right: Readonly<CanonicalSessionRef>,
): number {
  return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
}

function toApiRef(ref: Readonly<CanonicalSessionRef>): ApiSessionRef {
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

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function resolveSessionRefForRequest(
  refs: readonly CanonicalSessionRef[],
  request: Readonly<SessionLoadRequest>,
): CanonicalSessionRef | null {
  if (request.path) {
    const normalizedPath = normalizePathForId(request.path)
    return (
      refs.find((ref) => normalizePathForId(ref.path) === normalizedPath) ??
      refs.find((ref) => normalizePathForId(ref.id) === normalizedPath) ??
      null
    )
  }

  const sessionId = request.sessionId?.trim()
  if (!sessionId) {
    return null
  }

  const normalizedSessionId = normalizePathForId(sessionId)
  const directMatch = refs.find(
    (ref) =>
      normalizePathForId(ref.id) === normalizedSessionId ||
      normalizePathForId(ref.path) === normalizedSessionId,
  )
  if (directMatch) {
    return directMatch
  }

  const requestedBase = basename(sessionId)
  const requestedWithoutExt = basenameWithoutExtension(sessionId)

  return (
    refs.find((ref) => basename(ref.path) === sessionId) ??
    refs.find((ref) => basenameWithoutExtension(ref.path) === requestedBase) ??
    refs.find((ref) => basenameWithoutExtension(ref.path) === requestedWithoutExt)
  )
}

async function loadSessionSourcesFromDescriptors(
  descriptors: readonly ProviderDescriptor[],
  homeDirectory: string,
  moduleLoader?: CreateSessionSourceOptions['moduleLoader'],
): Promise<ProviderSourceAdapter[]> {
  const modules = await Promise.all(
    descriptors.map(async (descriptor) => {
      const loader =
        moduleLoader ??
        (async (loadedDescriptor: Readonly<ProviderDescriptor>) => {
          const pathUrl = new URL(loadedDescriptor.modulePath, import.meta.url)
          return (await import(pathUrl.href)) as SessionSourceFactoryModule
        })

      return await loader(descriptor)
    }),
  )

  const sources: ProviderSourceAdapter[] = []

  for (const module of modules) {
    const source = module ? await pickSessionSource(module, homeDirectory) : null
    if (source) {
      sources.push(createAdapterFromSessionSource(source))
    }
  }

  return sources
}

function createDefaultSessionSources(homeDirectory: string): ProviderSourceAdapter[] {
  return [
    createAdapterFromSessionProvider(createClaudeCodeProvider(), homeDirectory),
    createAdapterFromSessionProvider(createCodexProvider(), homeDirectory),
    createAdapterFromSessionProvider(createCopilotProvider(), homeDirectory),
    createAdapterFromSessionProvider(createCursorProvider(), homeDirectory),
    createAdapterFromSessionProvider(createGeminiProvider(), homeDirectory),
  ]
}

function createAdapterFromSessionProvider(
  provider: SessionProvider,
  homeDirectory: string,
): ProviderSourceAdapter {
  return {
    discover: async () => provider.discover({ homeDir: homeDirectory }),
    load: async (ref) => {
      const normalized = await provider.load(ref)
      return toMaterializedReplaySession(normalized)
    },
    search: async (request) => {
      const query = normalizeQuery(request.query)
      if (!query) {
        return []
      }

      const refs = await provider.discover({ homeDir: homeDirectory })
      const matches: CanonicalSessionRef[] = []

      for (const ref of refs) {
        const metadata = createRefHaystack(ref)
        if (metadata.includes(query)) {
          matches.push(ref)
          continue
        }

        const normalized = await provider.load(ref)
        if (sessionMatchesQuery(normalized, query)) {
          matches.push(ref)
        }
      }

      return request.limit ? matches.slice(0, request.limit) : matches
    },
  }
}

function createAdapterFromSessionSource(source: ProviderSessionSource): ProviderSourceAdapter {
  return {
    discover: async () => {
      const refs = await source.listSessions()
      return refs.map(toCanonicalRefFromApi)
    },
    load: async (ref) => source.loadSession({ path: ref.path }),
    search: async (request) => {
      const query = normalizeQuery(request.query)
      if (!query) {
        return []
      }

      if (source.searchSessions) {
        const refs = await source.searchSessions({ query, limit: request.limit })
        return refs.map(toCanonicalRefFromApi)
      }

      const refs = await source.listSessions()
      const canonicalRefs = refs.map(toCanonicalRefFromApi)
      const results: CanonicalSessionRef[] = []

      for (const ref of canonicalRefs) {
        const metadata = createRefHaystack(ref)
        if (metadata.includes(query)) {
          results.push(ref)
          continue
        }

        const loaded = await source.loadSession({ path: ref.path })
        if (materializedSessionMatches(loaded, toApiRef(ref), query)) {
          results.push(ref)
        }
      }

      return request.limit ? results.slice(0, request.limit) : results
    },
  }
}

function toCanonicalRefFromApi(ref: Readonly<ApiSessionRef>): CanonicalSessionRef {
  return {
    id: ref.id,
    path: ref.path,
    source: ref.source,
    project: ref.project ?? 'session',
    title: ref.title,
    startedAt: ref.startedAt ?? null,
    updatedAt: ref.updatedAt ?? null,
    cwd: ref.cwd ?? null,
    summary: ref.summary,
    stats: ref.stats,
  }
}

function createRefHaystack(ref: Readonly<CanonicalSessionRef> | Readonly<ApiSessionRef>): string {
  return [
    ref.id,
    ref.title,
    ref.path,
    ref.project,
    ref.cwd,
    ref.summary,
    ref.stats?.turnCount,
    ref.startedAt,
    ref.updatedAt,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function materializedSessionMatches(
  session: MaterializedReplaySession,
  ref: ApiSessionRef,
  query: string,
): boolean {
  const haystack = [
    ref.path,
    session.title,
    session.source,
    session.project,
    session.cwd,
    session.summary,
    ...session.turns.flatMap((turn) => [
      turn.blocks.map((block) => block.text),
      turn.toolCalls?.map((toolCall) => [
        toolCall.name,
        toolCall.input,
        toolCall.output,
      ]),
    ]),
  ]
    .flat(3)
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ')

  return haystack.includes(query)
}

async function pickSessionSource(
  module: SessionSourceFactoryModule,
  homeDirectory: string,
): Promise<ProviderSessionSource | null> {
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
