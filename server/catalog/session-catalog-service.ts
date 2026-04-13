import type { SessionCatalogStatus } from '../../src/lib/api/contracts'
import {
  createIndexedSessionEntry,
  decodeProjectFromAgentDir,
  displayNameFromPath,
} from '../providers/shared'
import { basenameWithoutExtension, normalizePathForId } from '../session-files/path-utils'
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
  SessionRef,
  SessionSearchRequest,
  SessionWarning,
} from './types'

const BACKGROUND_INDEX_CONCURRENCY = 8
const INITIAL_INDEX_BUDGET_MS = 15

interface CachedSession {
  file: SessionFileRef
  session: NormalizedSession
}

interface SessionCatalogServiceOptions {
  homeDir: string
  providers: readonly SessionCatalogProvider[]
}

interface ProviderScanResult {
  files: readonly SessionFileRef[] | null
  provider: SessionCatalogProvider
  warning: SessionWarning | null
}

interface IndexFileResult {
  entry: IndexedSessionEntry | null
  warning: SessionWarning | null
}

/**
 * Incrementally refreshed in-memory catalog for discovered session files.
 * Discovery builds a cheap snapshot first, then background indexing enriches it.
 */
export class SessionCatalogService {
  private activeForegroundLoads = 0
  private catalogWarnings: SessionWarning[] = []
  private catalogStatus: SessionCatalogStatus = createEmptyCatalogStatus()
  private readonly fileIndex = new Map<string, SessionFileRef>()
  private readonly idIndex = new Map<string, string>()
  private readonly fullSessionCache = new Map<string, CachedSession>()
  private readonly inflightIndex = new Map<string, Promise<IndexedSessionEntry>>()
  private readonly inflightLoad = new Map<string, Promise<NormalizedSession>>()
  private readonly foregroundIdleResolvers = new Set<() => void>()
  private indexingPromise: Promise<void> | null = null
  private pendingState: SessionCatalogStatus['state'] = 'ready'
  private readonly pendingIndexPaths = new Set<string>()
  private readonly providerBySource = new Map<string, SessionCatalogProvider>()
  private refreshGeneration = 0
  private readonly sessionIndex = new Map<string, IndexedSessionEntry>()
  private readonly sessionRefIndex = new Map<string, SessionRef>()
  private snapshotIsStale = false
  private snapshotTimestamp = new Date(0).toISOString()

  private initialized = false
  private refreshPromise: Promise<void> | null = null

  public constructor(private readonly options: SessionCatalogServiceOptions) {
    for (const provider of options.providers) {
      this.providerBySource.set(provider.source, provider)
    }
  }

  public getCatalogStatus(): SessionCatalogStatus {
    return {
      ...this.catalogStatus,
    }
  }

  public listCatalogWarnings(): readonly SessionWarning[] {
    return [...this.catalogWarnings]
  }

  public async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    const hasSnapshot = this.initialized
    this.refreshPromise = this.refreshInternal(hasSnapshot)
      .finally(() => {
        this.initialized = true
        this.refreshPromise = null
      })

    return this.refreshPromise
  }

  public async listSessions(): Promise<SessionRef[]> {
    await this.ensureReady()
    return [...this.sessionRefIndex.values()].sort(compareSessionRefs)
  }

  public async searchSessions(request: Readonly<SessionSearchRequest>) {
    const query = request.query.trim()
    if (!query) {
      return []
    }

    await this.ensureReady()

    if (this.pendingIndexPaths.size > 0 && this.indexingPromise) {
      await this.indexingPromise
    }

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
    const refs = [...this.sessionRefIndex.values()]
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

  private async refreshInternal(hasSnapshot: boolean): Promise<void> {
    const warnings: SessionWarning[] = []
    const scanResults = await Promise.all(
      this.options.providers.map(async (provider) => this.scanProvider(provider)),
    )

    const nextFileIndex = new Map<string, SessionFileRef>()
    const nextSessionIndex = new Map<string, IndexedSessionEntry>()
    const nextSessionRefIndex = new Map<string, SessionRef>()
    const nextIdIndex = new Map<string, string>()
    const nextFullSessionCache = new Map<string, CachedSession>()
    const changedFiles: SessionFileRef[] = []

    for (const { files, provider, warning } of scanResults) {
      if (warning) {
        warnings.push(warning)
      }

      if (!files) {
        this.copyProviderState(
          provider.source,
          nextFileIndex,
          nextSessionRefIndex,
          nextSessionIndex,
          nextIdIndex,
          nextFullSessionCache,
        )
        continue
      }

      for (const file of files) {
        nextFileIndex.set(file.path, file)

        const previousFile = this.fileIndex.get(file.path)
        const previousIndexedEntry = this.sessionIndex.get(file.path)
        const previousRef = this.sessionRefIndex.get(file.path)
        const isSameFingerprint = previousFile ? sameFileFingerprint(previousFile, file) : false

        if (isSameFingerprint && previousIndexedEntry) {
          nextSessionRefIndex.set(file.path, previousIndexedEntry.ref)
          nextSessionIndex.set(file.path, previousIndexedEntry)
          nextIdIndex.set(previousIndexedEntry.ref.id, file.path)

          const cachedSession = this.fullSessionCache.get(file.path)
          if (cachedSession && sameFileFingerprint(cachedSession.file, file)) {
            nextFullSessionCache.set(file.path, { file, session: cachedSession.session })
          }

          continue
        }

        const discoveredRef = previousRef ?? createDiscoveredSessionRef(file)
        nextSessionRefIndex.set(file.path, discoveredRef)
        nextIdIndex.set(discoveredRef.id, file.path)
        changedFiles.push(file)
      }
    }

    replaceMap(this.fileIndex, nextFileIndex)
    replaceMap(this.sessionIndex, nextSessionIndex)
    replaceMap(this.sessionRefIndex, nextSessionRefIndex)
    replaceMap(this.idIndex, nextIdIndex)
    replaceMap(this.fullSessionCache, nextFullSessionCache)

    this.catalogWarnings = warnings
    this.pendingIndexPaths.clear()
    for (const file of changedFiles) {
      this.pendingIndexPaths.add(file.path)
    }

    this.snapshotTimestamp = new Date().toISOString()
    this.pendingState = hasSnapshot ? 'refreshing' : 'indexing'
    this.snapshotIsStale = hasSnapshot && changedFiles.length > 0
    this.updateCatalogStatus()

    if (changedFiles.length === 0) {
      this.pendingState = 'ready'
      this.snapshotIsStale = false
      this.updateCatalogStatus()
      return
    }

    const generation = ++this.refreshGeneration
    const indexingPromise = this.runBackgroundIndexing(generation, changedFiles, warnings)
    this.indexingPromise = indexingPromise
    void indexingPromise.finally(() => {
      if (this.indexingPromise === indexingPromise) {
        this.indexingPromise = null
      }
    })

    if (!hasSnapshot) {
      await Promise.race([indexingPromise, wait(INITIAL_INDEX_BUDGET_MS)])
    }
  }

  private copyProviderState(
    source: string,
    nextFileIndex: Map<string, SessionFileRef>,
    nextSessionRefIndex: Map<string, SessionRef>,
    nextSessionIndex: Map<string, IndexedSessionEntry>,
    nextIdIndex: Map<string, string>,
    nextFullSessionCache: Map<string, CachedSession>,
  ): void {
    for (const file of this.fileIndex.values()) {
      if (file.source !== source) {
        continue
      }

      nextFileIndex.set(file.path, file)

      const sessionRef = this.sessionRefIndex.get(file.path)
      if (sessionRef) {
        nextSessionRefIndex.set(file.path, sessionRef)
        nextIdIndex.set(sessionRef.id, file.path)
      }

      const indexedEntry = this.sessionIndex.get(file.path)
      if (indexedEntry) {
        nextSessionIndex.set(file.path, indexedEntry)
        nextIdIndex.set(indexedEntry.ref.id, file.path)
      }

      const cachedSession = this.fullSessionCache.get(file.path)
      if (cachedSession && sameFileFingerprint(cachedSession.file, file)) {
        nextFullSessionCache.set(file.path, cachedSession)
      }
    }
  }

  private async runBackgroundIndexing(
    generation: number,
    files: readonly SessionFileRef[],
    baseWarnings: readonly SessionWarning[],
  ): Promise<void> {
    const nextWarnings = [...baseWarnings]

    await runWithConcurrency(files, BACKGROUND_INDEX_CONCURRENCY, async (file) => {
      if (!this.pendingIndexPaths.has(file.path)) {
        return
      }

      await this.waitForForegroundIdle()

      if (!this.pendingIndexPaths.has(file.path)) {
        return
      }

      const result = await this.safeIndexFile(file)
      if (generation !== this.refreshGeneration) {
        return
      }

      const currentFile = this.fileIndex.get(file.path)
      if (!currentFile || !sameFileFingerprint(currentFile, file)) {
        return
      }

      if (!this.pendingIndexPaths.has(file.path)) {
        return
      }

      this.pendingIndexPaths.delete(file.path)

      if (result.warning) {
        nextWarnings.push(result.warning)
        this.sessionIndex.delete(file.path)
      }

      if (result.entry) {
        this.sessionIndex.set(file.path, result.entry)
        this.sessionRefIndex.set(file.path, result.entry.ref)
        this.updateIdIndexForPath(file.path, result.entry.ref)
      }

      this.catalogWarnings = dedupeWarnings(nextWarnings)
      if (this.pendingIndexPaths.size === 0) {
        this.pendingState = 'ready'
        this.snapshotIsStale = false
      }
      this.updateCatalogStatus()
    })

    if (generation !== this.refreshGeneration) {
      return
    }

    this.catalogWarnings = dedupeWarnings(nextWarnings)
    if (this.pendingIndexPaths.size === 0) {
      this.pendingState = 'ready'
      this.snapshotIsStale = false
    }
    this.updateCatalogStatus()
  }

  private updateCatalogStatus(): void {
    this.catalogStatus = {
      discoveredCount: this.fileIndex.size,
      indexedCount: this.countIndexedSnapshotFiles(),
      pendingCount: this.pendingIndexPaths.size,
      snapshotAt: this.snapshotTimestamp,
      stale: this.snapshotIsStale,
      state: this.pendingIndexPaths.size > 0 ? this.pendingState : 'ready',
    }
  }

  private countIndexedSnapshotFiles(): number {
    let count = 0

    for (const path of this.fileIndex.keys()) {
      if (this.pendingIndexPaths.has(path)) {
        continue
      }

      if (this.sessionIndex.has(path)) {
        count += 1
      }
    }

    return count
  }

  private updateIdIndexForPath(path: string, ref: Readonly<SessionRef>): void {
    for (const [id, existingPath] of this.idIndex.entries()) {
      if (existingPath === path && id !== ref.id) {
        this.idIndex.delete(id)
      }
    }

    this.idIndex.set(ref.id, path)
  }

  private async scanProvider(provider: SessionCatalogProvider): Promise<ProviderScanResult> {
    try {
      return {
        files: await provider.scan({ homeDir: this.options.homeDir }),
        provider,
        warning: null,
      }
    } catch (error) {
      this.reportCatalogFailure('scan', provider.source, error)
      return {
        files: null,
        provider,
        warning: {
          code: 'catalog_scan_failed',
          message: `Failed to scan ${provider.source} sessions`,
        },
      }
    }
  }

  private async safeIndexFile(file: Readonly<SessionFileRef>): Promise<IndexFileResult> {
    try {
      return {
        entry: await this.indexFile(file),
        warning: null,
      }
    } catch (error) {
      this.reportCatalogFailure('index', file.source, error, file.path)
      return {
        entry: null,
        warning: {
          code: 'catalog_index_failed',
          filePath: file.path,
          message: `Failed to index ${file.source} session`,
        },
      }
    }
  }

  private reportCatalogFailure(
    phase: 'index' | 'scan',
    source: string,
    error: unknown,
    filePath?: string,
  ): void {
    const details = {
      error: error instanceof Error ? error.message : String(error),
      filePath,
      source,
    }

    console.error(`[catalog] ${phase} failed`, details)
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

    const releaseForegroundLoad = this.beginForegroundLoad()
    const promise = provider
      .load(file)
      .then((session) => {
        this.fullSessionCache.set(file.path, { file, session })
        this.commitLoadedSession(file, session)
        return session
      })
      .finally(() => {
        releaseForegroundLoad()
        this.inflightLoad.delete(file.path)
      })

    this.inflightLoad.set(file.path, promise)
    return promise
  }

  private beginForegroundLoad(): () => void {
    this.activeForegroundLoads += 1

    return () => {
      this.activeForegroundLoads = Math.max(0, this.activeForegroundLoads - 1)
      if (this.activeForegroundLoads === 0) {
        for (const resolve of this.foregroundIdleResolvers) {
          resolve()
        }
        this.foregroundIdleResolvers.clear()
      }
    }
  }

  private commitLoadedSession(file: Readonly<SessionFileRef>, session: Readonly<NormalizedSession>): void {
    const entry = createIndexedSessionEntry(file, session)

    this.sessionIndex.set(file.path, entry)
    this.sessionRefIndex.set(file.path, entry.ref)
    this.updateIdIndexForPath(file.path, entry.ref)
    this.pendingIndexPaths.delete(file.path)
    this.catalogWarnings = this.catalogWarnings.filter(
      (warning) => !(warning.code === 'catalog_index_failed' && warning.filePath === file.path),
    )
    if (this.pendingIndexPaths.size === 0) {
      this.pendingState = 'ready'
      this.snapshotIsStale = false
    }
    this.updateCatalogStatus()
  }

  private async waitForForegroundIdle(): Promise<void> {
    while (this.activeForegroundLoads > 0) {
      await new Promise<void>((resolve) => {
        this.foregroundIdleResolvers.add(resolve)
      })
    }
  }
}

function createDiscoveredSessionRef(file: Readonly<SessionFileRef>): SessionRef {
  return {
    id: `${file.source}:${normalizePathForId(file.relativePath)}`,
    path: file.path,
    source: file.source,
    project: inferProjectFromFile(file),
    title: basenameWithoutExtension(file.path) || displayNameFromPath(file.path),
    startedAt: null,
    updatedAt: new Date(file.fingerprint.mtimeMs).toISOString(),
    cwd: null,
  }
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

function dedupeWarnings(warnings: readonly SessionWarning[]): SessionWarning[] {
  const seen = new Set<string>()
  const next: SessionWarning[] = []

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.filePath ?? ''}:${warning.message}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    next.push(warning)
  }

  return next
}

function inferProjectFromFile(file: Readonly<SessionFileRef>): string {
  const parts = normalizePathForId(file.relativePath).split('/').filter(Boolean)
  const firstPart = parts[0]

  if (firstPart?.startsWith('-')) {
    return decodeProjectFromAgentDir(firstPart)
  }

  for (const part of [...parts].reverse()) {
    if (
      part === basenameWithoutExtension(file.path) ||
      part === 'agent-transcripts' ||
      part === 'chats' ||
      part === 'session-state' ||
      part === 'sessions' ||
      part === 'subagents' ||
      /^\d{2,4}$/.test(part) ||
      /^(chat|cursor|session)-/i.test(part)
    ) {
      continue
    }

    return part
  }

  return file.source
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

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workerCount = Math.max(1, Math.min(concurrency, queue.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (!item) {
          return
        }

        await worker(item)
      }
    }),
  )
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
