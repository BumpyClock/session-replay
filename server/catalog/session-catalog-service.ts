import { ApiError } from '../api/errors'
import {
  compareSessionRefs,
  indexedSessionMatchesQuery,
  matchSessionRefForRequest,
} from './search'
import type {
  IndexedSessionEntry,
  NormalizedSession,
  SessionCatalogProvider,
  SessionFileRef,
  SessionLoadRequest,
  SessionSearchRequest,
} from './types'

interface CachedSession {
  file: SessionFileRef
  session: NormalizedSession
}

interface SessionCatalogServiceOptions {
  homeDir: string
  providers: readonly SessionCatalogProvider[]
}

export class SessionCatalogService {
  private readonly fileIndex = new Map<string, SessionFileRef>()
  private readonly idIndex = new Map<string, string>()
  private readonly fullSessionCache = new Map<string, CachedSession>()
  private readonly inflightIndex = new Map<string, Promise<IndexedSessionEntry>>()
  private readonly inflightLoad = new Map<string, Promise<NormalizedSession>>()
  private readonly providerBySource = new Map<string, SessionCatalogProvider>()
  private readonly sessionIndex = new Map<string, IndexedSessionEntry>()

  private initialized = false
  private refreshPromise: Promise<void> | null = null

  public constructor(private readonly options: SessionCatalogServiceOptions) {
    for (const provider of options.providers) {
      this.providerBySource.set(provider.source, provider)
    }
  }

  public async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    this.refreshPromise = this.refreshInternal()
      .then(() => {
        this.initialized = true
      })
      .finally(() => {
        this.refreshPromise = null
      })

    return this.refreshPromise
  }

  public async listSessions() {
    await this.ensureReady()
    return [...this.sessionIndex.values()]
      .map((entry) => entry.ref)
      .sort(compareSessionRefs)
  }

  public async searchSessions(request: Readonly<SessionSearchRequest>) {
    const query = request.query.trim()
    if (!query) {
      return []
    }

    await this.ensureReady()

    const matches = [...this.sessionIndex.values()]
      .filter((entry) => indexedSessionMatchesQuery(entry, query))
      .map((entry) => entry.ref)
      .sort(compareSessionRefs)

    return typeof request.limit === 'number' ? matches.slice(0, request.limit) : matches
  }

  public async loadSession(request: Readonly<SessionLoadRequest>): Promise<NormalizedSession> {
    await this.ensureReady()

    let file = this.resolveFileForRequest(request)
    if (!file) {
      await this.refresh()
      file = this.resolveFileForRequest(request)
    }

    if (!file) {
      throw new ApiError(404, 'session_not_found', 'Session not found')
    }

    return this.loadFile(file)
  }

  private async ensureReady(): Promise<void> {
    if (!this.initialized) {
      await this.refresh()
    }
  }

  private resolveFileForRequest(request: Readonly<SessionLoadRequest>): SessionFileRef | null {
    const refs = [...this.sessionIndex.values()].map((entry) => entry.ref)
    const match = matchSessionRefForRequest(refs, request)
    if (match) {
      const directMatch = this.fileIndex.get(match.path)
      if (directMatch) {
        return directMatch
      }
    }

    if (!request.path) {
      return null
    }

    const normalizedRequestPath = normalizeSessionPath(request.path)
    return (
      [...this.fileIndex.values()].find((file) => normalizeSessionPath(file.path) === normalizedRequestPath) ??
      null
    )

  }

  private async refreshInternal(): Promise<void> {
    const scanResults = await Promise.all(
      this.options.providers.map(async (provider) => ({
        files: await provider.scan({ homeDir: this.options.homeDir }),
        provider,
      })),
    )

    const nextFileIndex = new Map<string, SessionFileRef>()
    const nextSessionIndex = new Map<string, IndexedSessionEntry>()
    const nextIdIndex = new Map<string, string>()
    const nextFullSessionCache = new Map<string, CachedSession>()
    const changedFiles: SessionFileRef[] = []

    for (const { files } of scanResults) {
      for (const file of files) {
        nextFileIndex.set(file.path, file)
        const previous = this.fileIndex.get(file.path)
        const previousIndexEntry = this.sessionIndex.get(file.path)
        if (!previous || !previousIndexEntry || !sameFileFingerprint(previous, file)) {
          changedFiles.push(file)
          continue
        }

        nextSessionIndex.set(file.path, previousIndexEntry)
        nextIdIndex.set(previousIndexEntry.ref.id, file.path)
      }
    }

    for (const [path, cachedSession] of this.fullSessionCache.entries()) {
      const nextFile = nextFileIndex.get(path)
      if (nextFile && sameFileFingerprint(cachedSession.file, nextFile)) {
        nextFullSessionCache.set(path, cachedSession)
      }
    }

    const indexedEntries = await Promise.all(changedFiles.map((file) => this.indexFile(file)))

    for (const entry of indexedEntries) {
      nextFileIndex.set(entry.file.path, entry.file)
      nextSessionIndex.set(entry.file.path, entry)
      nextIdIndex.set(entry.ref.id, entry.file.path)
    }

    replaceMap(this.fileIndex, nextFileIndex)
    replaceMap(this.sessionIndex, nextSessionIndex)
    replaceMap(this.idIndex, nextIdIndex)
    replaceMap(this.fullSessionCache, nextFullSessionCache)
  }

  private async indexFile(file: Readonly<SessionFileRef>): Promise<IndexedSessionEntry> {
    const existing = this.inflightIndex.get(file.path)
    if (existing) {
      return existing
    }

    const provider = this.providerBySource.get(file.source)
    if (!provider) {
      throw new ApiError(500, 'provider_not_found', `Provider ${file.source} not available`)
    }

    const promise = provider
      .index(file)
      .finally(() => {
        this.inflightIndex.delete(file.path)
      })

    this.inflightIndex.set(file.path, promise)
    return promise
  }

  private async loadFile(file: Readonly<SessionFileRef>): Promise<NormalizedSession> {
    const cached = this.fullSessionCache.get(file.path)
    if (cached && sameFileFingerprint(cached.file, file)) {
      return cached.session
    }

    const existing = this.inflightLoad.get(file.path)
    if (existing) {
      return existing
    }

    const provider = this.providerBySource.get(file.source)
    if (!provider) {
      throw new ApiError(500, 'provider_not_found', `Provider ${file.source} not available`)
    }

    const promise = provider
      .load(file)
      .then((session) => {
        this.fullSessionCache.set(file.path, { file, session })
        return session
      })
      .finally(() => {
        this.inflightLoad.delete(file.path)
      })

    this.inflightLoad.set(file.path, promise)
    return promise
  }
}

function sameFileFingerprint(left: Readonly<SessionFileRef>, right: Readonly<SessionFileRef>): boolean {
  return (
    left.source === right.source &&
    left.fingerprint.path === right.fingerprint.path &&
    left.fingerprint.mtimeMs === right.fingerprint.mtimeMs &&
    left.fingerprint.size === right.fingerprint.size
  )
}

function normalizeSessionPath(value: string): string {
  return value.replaceAll('\\', '/').trim().toLowerCase().replace(/\/+$/, '')
}

function replaceMap<TKey, TValue>(
  target: Map<TKey, TValue>,
  next: ReadonlyMap<TKey, TValue>,
): void {
  target.clear()
  for (const [key, value] of next.entries()) {
    target.set(key, value)
  }
}
