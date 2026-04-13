import { describe, expect, it, vi } from 'vitest'
import { SessionCatalogService } from '../../server/catalog'
import type {
  IndexedSessionEntry,
  NormalizedSession,
  SessionCatalogProvider,
  SessionFileRef,
} from '../../src/lib/session'

describe('SessionCatalogService', () => {
  it('reuses warm index/search/load state and skips reindex on unchanged refresh', async () => {
    const file = createFile('copilot:alpha/events.jsonl')
    const session = createSession(file, { title: 'Inspect repo' })
    const indexed = createIndexedEntry(file, session, {
      metadataText: 'inspect repo alpha',
      transcriptText: 'inspect repo transcript',
    })

    const provider: SessionCatalogProvider = {
      source: 'copilot',
      scan: vi.fn(async () => [file]),
      index: vi.fn(async () => indexed),
      load: vi.fn(async () => session),
    }

    const service = new SessionCatalogService({
      homeDir: '/tmp',
      providers: [provider],
    })

    await expect(service.listSessions()).resolves.toEqual([indexed.ref])
    await expect(service.listSessions()).resolves.toEqual([indexed.ref])
    await expect(service.searchSessions({ query: 'transcript', limit: 10 })).resolves.toEqual([
      indexed.ref,
    ])
    await expect(service.loadSession({ path: file.path })).resolves.toEqual(session)
    await expect(service.loadSession({ path: file.path })).resolves.toEqual(session)

    expect(provider.scan).toHaveBeenCalledTimes(1)
    expect(provider.index).toHaveBeenCalledTimes(1)
    expect(provider.load).toHaveBeenCalledTimes(1)

    await service.refresh()

    expect(provider.scan).toHaveBeenCalledTimes(2)
    expect(provider.index).toHaveBeenCalledTimes(1)
    expect(provider.load).toHaveBeenCalledTimes(1)
  })

  it('keeps catalog empty after failed first refresh and retries successfully', async () => {
    const file = createFile('copilot:alpha/events.jsonl')
    const session = createSession(file, { title: 'Recovered session' })
    const indexed = createIndexedEntry(file, session, {
      metadataText: 'recovered session alpha',
      transcriptText: 'recovered session transcript',
    })

    let shouldFail = true
    const provider: SessionCatalogProvider = {
      source: 'copilot',
      scan: vi.fn(async () => [file]),
      index: vi.fn(async () => {
        if (shouldFail) {
          throw new Error('index failed')
        }

        return indexed
      }),
      load: vi.fn(async () => session),
    }

    const service = new SessionCatalogService({
      homeDir: '/tmp',
      providers: [provider],
    })

    await expect(service.listSessions()).rejects.toThrow('index failed')

    const state = service as unknown as {
      fileIndex: Map<string, SessionFileRef>
      initialized: boolean
      sessionIndex: Map<string, IndexedSessionEntry>
    }
    expect(state.initialized).toBe(false)
    expect(state.fileIndex.size).toBe(0)
    expect(state.sessionIndex.size).toBe(0)

    shouldFail = false

    await expect(service.listSessions()).resolves.toEqual([indexed.ref])
    await expect(service.loadSession({ path: file.path })).resolves.toEqual(session)

    expect(provider.scan).toHaveBeenCalledTimes(2)
    expect(provider.index).toHaveBeenCalledTimes(2)
    expect(provider.load).toHaveBeenCalledTimes(1)
  })

  it('loads a session when request path differs only by path separators and case', async () => {
    const file = createFile('copilot:alpha/events/session-1.jsonl')
    const session = createSession(file, { title: 'Path normalizer' })
    const indexed = createIndexedEntry(file, session, {
      metadataText: 'path normalizer',
      transcriptText: 'path normalizer transcript',
    })

    const provider: SessionCatalogProvider = {
      source: 'copilot',
      scan: vi.fn(async () => [file]),
      index: vi.fn(async () => indexed),
      load: vi.fn(async () => session),
    }

    const service = new SessionCatalogService({
      homeDir: '/tmp',
      providers: [provider],
    })

    const requestPath = file.path.replaceAll('/', '\\').toUpperCase()

    await expect(service.loadSession({ path: requestPath })).resolves.toEqual(session)

    expect(provider.scan).toHaveBeenCalledTimes(1)
    expect(provider.index).toHaveBeenCalledTimes(1)
    expect(provider.load).toHaveBeenCalledTimes(1)
  })

  it('does not commit changed or deleted entries when refresh fails', async () => {
    const alphaV1 = createFile('copilot:alpha/events.jsonl', { mtimeMs: 10, size: 20 })
    const betaV1 = createFile('copilot:beta/events.jsonl', { mtimeMs: 11, size: 20 })
    const alphaV2 = createFile('copilot:alpha/events.jsonl', { mtimeMs: 20, size: 25 })

    const alphaSessionV1 = createSession(alphaV1, {
      project: 'alpha',
      title: 'Alpha old',
      updatedAt: '2026-04-13T10:02:00.000Z',
    })
    const betaSessionV1 = createSession(betaV1, {
      project: 'beta',
      title: 'Beta old',
      updatedAt: '2026-04-13T10:01:00.000Z',
    })
    const alphaSessionV2 = createSession(alphaV2, {
      project: 'alpha',
      title: 'Alpha new',
      updatedAt: '2026-04-13T10:03:00.000Z',
    })

    const alphaEntryV1 = createIndexedEntry(alphaV1, alphaSessionV1, {
      metadataText: 'alpha old stable',
      transcriptText: 'alpha transcript old',
    })
    const betaEntryV1 = createIndexedEntry(betaV1, betaSessionV1, {
      metadataText: 'beta old stable',
      transcriptText: 'beta transcript old',
    })
    const alphaEntryV2 = createIndexedEntry(alphaV2, alphaSessionV2, {
      metadataText: 'alpha new stable',
      transcriptText: 'alpha transcript new',
    })

    let phase: 'initial' | 'refresh-fail' | 'refresh-success' = 'initial'
    const provider: SessionCatalogProvider = {
      source: 'copilot',
      scan: vi.fn(async () => {
        if (phase === 'initial') {
          return [alphaV1, betaV1]
        }

        return [alphaV2]
      }),
      index: vi.fn(async (file) => {
        if (phase === 'initial') {
          return file.path === alphaV1.path ? alphaEntryV1 : betaEntryV1
        }

        if (phase === 'refresh-fail') {
          throw new Error('refresh failed')
        }

        return alphaEntryV2
      }),
      load: vi.fn(async (file) => {
        if (phase === 'initial') {
          return file.path === alphaV1.path ? alphaSessionV1 : betaSessionV1
        }

        return alphaSessionV2
      }),
    }

    const service = new SessionCatalogService({
      homeDir: '/tmp',
      providers: [provider],
    })

    await expect(service.listSessions()).resolves.toEqual([alphaEntryV1.ref, betaEntryV1.ref])

    phase = 'refresh-fail'
    await expect(service.refresh()).rejects.toThrow('refresh failed')

    await expect(service.listSessions()).resolves.toEqual([alphaEntryV1.ref, betaEntryV1.ref])
    await expect(service.searchSessions({ query: 'alpha new' })).resolves.toEqual([])
    await expect(service.searchSessions({ query: 'beta old' })).resolves.toEqual([betaEntryV1.ref])

    const failedState = service as unknown as {
      fileIndex: Map<string, SessionFileRef>
      sessionIndex: Map<string, IndexedSessionEntry>
    }
    expect(failedState.fileIndex.get(alphaV1.path)?.fingerprint.mtimeMs).toBe(10)
    expect(failedState.fileIndex.has(betaV1.path)).toBe(true)
    expect(failedState.sessionIndex.get(alphaV1.path)?.ref.title).toBe('Alpha old')

    phase = 'refresh-success'
    await expect(service.refresh()).resolves.toBeUndefined()
    await expect(service.listSessions()).resolves.toEqual([alphaEntryV2.ref])
    await expect(service.searchSessions({ query: 'alpha new' })).resolves.toEqual([alphaEntryV2.ref])
    await expect(service.searchSessions({ query: 'beta old' })).resolves.toEqual([])

    const successState = service as unknown as {
      fileIndex: Map<string, SessionFileRef>
    }
    expect(successState.fileIndex.get(alphaV2.path)?.fingerprint.mtimeMs).toBe(20)
    expect(successState.fileIndex.has(betaV1.path)).toBe(false)
  })
})

function createFile(
  id: string,
  options: {
    mtimeMs?: number
    size?: number
    source?: SessionFileRef['source']
  } = {},
): SessionFileRef {
  const path = `/tmp/${id.replace(':', '/')}`
  return {
    source: options.source ?? 'copilot',
    path,
    relativePath: id.replace(/^[^:]+:/, ''),
    fingerprint: {
      path,
      mtimeMs: options.mtimeMs ?? 10,
      size: options.size ?? 20,
    },
  }
}

function createSession(
  file: Readonly<SessionFileRef>,
  options: {
    project?: string
    title?: string
    updatedAt?: string
  } = {},
): NormalizedSession {
  const project = options.project ?? 'alpha'
  return {
    ref: {
      id: `${file.source}:${file.relativePath}`,
      path: file.path,
      source: file.source,
      project,
      title: options.title ?? 'Inspect repo',
      startedAt: '2026-04-13T10:00:00.000Z',
      updatedAt: options.updatedAt ?? '2026-04-13T10:01:00.000Z',
      cwd: `/tmp/${project}`,
    },
    cwd: `/tmp/${project}`,
    warnings: [],
    turns: [],
  }
}

function createIndexedEntry(
  file: Readonly<SessionFileRef>,
  session: Readonly<NormalizedSession>,
  searchDoc: IndexedSessionEntry['searchDoc'],
): IndexedSessionEntry {
  return {
    file,
    ref: {
      ...session.ref,
      summary: session.ref.title,
      stats: {
        turnCount: 0,
        userTurnCount: 0,
        assistantTurnCount: 0,
        toolCallCount: 0,
      },
    },
    searchDoc,
    warnings: [],
  }
}
