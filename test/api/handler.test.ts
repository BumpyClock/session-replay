import { describe, expect, it, vi } from 'vitest'
import { createApiHandler } from '../../server/api/handler'
import { API_HEALTH_PATH } from '../../server/api/routes'
import type { SessionSource } from '../../server/api/session-source'

const allowedOrigins = ['http://127.0.0.1:5173']

function createSessionSource(overrides: Partial<SessionSource> = {}): SessionSource {
  return {
    listSessions: vi.fn().mockResolvedValue([]),
    refreshSessions: vi.fn().mockResolvedValue([]),
    loadSession: vi.fn().mockResolvedValue(createMinimalSession()),
    searchSessions: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function createMinimalSession() {
  return {
    id: 'session-1',
    source: 'codex',
    title: 'Demo session',
    turns: [],
  }
}

function jsonRequest(path: string, body: unknown, origin?: string): Request {
  return new Request(`http://127.0.0.1:4848${path}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    method: 'POST',
  })
}

const invalidRequestError = {
  error: {
    code: 'invalid_request',
    message: 'Request body does not match the expected shape',
  },
}

function createFixtureSessionRef() {
  return {
    id: 'session-1',
    path: 'C:/Users/test/.codex/sessions/session-1.jsonl',
    project: 'demo-project',
    source: 'codex',
    title: 'Demo session',
    updatedAt: '2026-04-13T08:00:00.000Z',
  }
}

describe('createApiHandler', () => {
  it('returns health without triggering catalog work', async () => {
    const sessionSource: SessionSource = {
      listSessions: vi.fn().mockResolvedValue([]),
      refreshSessions: vi.fn().mockResolvedValue([]),
      loadSession: vi.fn(),
      searchSessions: vi.fn(),
    }
    const handler = createApiHandler({ sessionSource })

    const response = await handler(new Request(`http://127.0.0.1:4848${API_HEALTH_PATH}`))

    expect(response.status).toBe(204)
    expect(sessionSource.listSessions).not.toHaveBeenCalled()
    expect(sessionSource.refreshSessions).not.toHaveBeenCalled()
  })

  it('returns discovered sessions from GET /api/sessions', async () => {
    const listSessions = vi.fn().mockResolvedValue([createFixtureSessionRef()])
    const sessionSource: SessionSource = {
      listSessions,
      listCatalogWarnings: () => [],
      refreshSessions: vi.fn().mockResolvedValue([]),
      loadSession: vi.fn(),
      searchSessions: vi.fn(),
    }
    const handler = createApiHandler({ sessionSource })

    const response = await handler(new Request('http://127.0.0.1:4848/api/sessions'))

    expect(response.status).toBe(200)
    expect(listSessions).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toEqual({
      sessions: [createFixtureSessionRef()],
    })
  })

  it('refreshes sessions through POST /api/sessions/refresh', async () => {
    const refreshSessions = vi.fn().mockResolvedValue([createFixtureSessionRef()])
    const sessionSource: SessionSource = {
      listSessions: vi.fn().mockResolvedValue([]),
      listCatalogWarnings: () => [],
      refreshSessions,
      loadSession: vi.fn(),
      searchSessions: vi.fn(),
    }
    const handler = createApiHandler({ sessionSource })

    const response = await handler(
      new Request('http://127.0.0.1:4848/api/sessions/refresh', {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(refreshSessions).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toEqual({
      sessions: [createFixtureSessionRef()],
    })
  })

  it('includes catalog warnings in the session list response', async () => {
    const warning = {
      code: 'catalog_index_failed',
      filePath: '/tmp/broken.json',
      message: 'Failed to index gemini session',
    }
    const sessionSource: SessionSource = {
      listSessions: vi.fn().mockResolvedValue([createFixtureSessionRef()]),
      listCatalogWarnings: () => [warning],
      refreshSessions: vi.fn().mockResolvedValue([]),
      loadSession: vi.fn(),
      searchSessions: vi.fn(),
    }
    const handler = createApiHandler({ sessionSource })

    const response = await handler(new Request('http://127.0.0.1:4848/api/sessions'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      sessions: [createFixtureSessionRef()],
      warnings: [warning],
    })
  })

  it('includes catalog status in the session list response', async () => {
    const sessionSource: SessionSource = {
      getCatalogStatus: () => ({
        discoveredCount: 4,
        indexedCount: 1,
        pendingCount: 3,
        snapshotAt: '2026-04-13T12:00:00.000Z',
        stale: false,
        state: 'indexing',
      }),
      listSessions: vi.fn().mockResolvedValue([createFixtureSessionRef()]),
      listCatalogWarnings: () => [],
      refreshSessions: vi.fn().mockResolvedValue([]),
      loadSession: vi.fn(),
      searchSessions: vi.fn(),
    }
    const handler = createApiHandler({ sessionSource })

    const response = await handler(new Request('http://127.0.0.1:4848/api/sessions'))

    await expect(response.json()).resolves.toEqual({
      catalog: {
        discoveredCount: 4,
        indexedCount: 1,
        pendingCount: 3,
        snapshotAt: '2026-04-13T12:00:00.000Z',
        stale: false,
        state: 'indexing',
      },
      sessions: [createFixtureSessionRef()],
    })
  })

  it('reflects an allowed exact Origin', async () => {
    const handler = createApiHandler({ allowedOrigins, sessionSource: createSessionSource() })
    const response = await handler(
      new Request('http://127.0.0.1:4848/api/sessions', {
        headers: { Origin: allowedOrigins[0] },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigins[0])
  })

  it.each(['http://127.0.0.1:6666', 'http://localhost:5173'])(
    'rejects an unlisted Origin %s before catalog access',
    async (origin) => {
      const listSessions = vi.fn().mockResolvedValue([])
      const handler = createApiHandler({
        allowedOrigins,
        sessionSource: createSessionSource({ listSessions }),
      })
      const response = await handler(
        new Request('http://127.0.0.1:4848/api/sessions', { headers: { Origin: origin } }),
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'origin_not_allowed' } })
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
      expect(listSessions).not.toHaveBeenCalled()
    },
  )

  it('allows no-Origin requests without a CORS reflection header', async () => {
    const handler = createApiHandler({ allowedOrigins, sessionSource: createSessionSource() })
    const response = await handler(new Request('http://127.0.0.1:4848/api/sessions'))

    expect(response.status).toBe(200)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('returns full CORS headers for an allowed preflight', async () => {
    const handler = createApiHandler({ allowedOrigins, sessionSource: createSessionSource() })
    const response = await handler(
      new Request('http://127.0.0.1:4848/api/sessions', {
        headers: { Origin: allowedOrigins[0] },
        method: 'OPTIONS',
      }),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigins[0])
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type')
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('rejects a disallowed preflight before catalog access', async () => {
    const listSessions = vi.fn().mockResolvedValue([])
    const handler = createApiHandler({
      allowedOrigins,
      sessionSource: createSessionSource({ listSessions }),
    })
    const response = await handler(
      new Request('http://127.0.0.1:4848/api/sessions', {
        headers: { Origin: 'http://127.0.0.1:6666' },
        method: 'OPTIONS',
      }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(listSessions).not.toHaveBeenCalled()
  })

  it('returns invalid_json for malformed JSON', async () => {
    const sessionSource = createSessionSource()
    const handler = createApiHandler({ sessionSource })
    const response = await handler(
      new Request('http://127.0.0.1:4848/api/search', {
        body: '{',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'invalid_json', message: 'Request body must be valid JSON' },
    })
    expect(sessionSource.searchSessions).not.toHaveBeenCalled()
  })

  it.each([
    ['/api/load', null, 'loadSession'],
    ['/api/load', {}, 'loadSession'],
    ['/api/load', [], 'loadSession'],
    ['/api/load', { sessionId: 1 }, 'loadSession'],
    ['/api/search', null, 'searchSessions'],
    ['/api/search', {}, 'searchSessions'],
    ['/api/search', [], 'searchSessions'],
    ['/api/search', { query: 1 }, 'searchSessions'],
    ['/api/search', { limit: 0, query: 'demo' }, 'searchSessions'],
    ['/api/export', null, 'loadSession'],
    ['/api/export', {}, 'loadSession'],
    ['/api/export', [], 'loadSession'],
    ['/api/export', { session: { ...createMinimalSession(), turns: [{ blocks: [], id: '1', index: -1, role: 'user' }] } }, 'loadSession'],
    ['/api/export', { session: { ...createMinimalSession(), turns: [{ blocks: [], id: '1', index: 0, role: 'invalid' }] } }, 'loadSession'],
    ['/api/export', { session: { ...createMinimalSession(), turns: [{ blocks: [{ id: 'b', text: 'x', type: 'invalid' }], id: '1', index: 0, role: 'user' }] } }, 'loadSession'],
    ['/api/export', { session: { ...createMinimalSession(), turns: [{ blocks: [{ id: 'b', text: 1, type: 'text' }], id: '1', index: 0, role: 'user' }] } }, 'loadSession'],
    ['/api/export', { session: { ...createMinimalSession(), turns: [{ blocks: [{ id: 'b', name: 'Read', status: 'invalid', type: 'tool' }], id: '1', index: 0, role: 'user' }] } }, 'loadSession'],
    ['/api/export', { session: { ...createMinimalSession(), bookmarks: [{ id: 'b', label: 'Start', turnIndex: -1 }] } }, 'loadSession'],
    ['/api/export', { options: { autoplayDelayMs: -1 }, session: createMinimalSession() }, 'loadSession'],
  ] as const)('rejects invalid request body for %s', async (path, body, dependency) => {
    const sessionSource = createSessionSource()
    const handler = createApiHandler({ sessionSource })
    const response = await handler(jsonRequest(path, body))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(invalidRequestError)
    expect(sessionSource[dependency]).not.toHaveBeenCalled()
  })

  it.each([
    ['/api/load', { sessionId: 'session-1', unexpected: true }],
    ['/api/search', { query: 'demo', unexpected: true }],
    ['/api/export', { session: createMinimalSession(), unexpected: true }],
    ['/api/export', {
      session: { ...createMinimalSession(), unexpected: true },
    }],
    ['/api/export', {
      session: {
        ...createMinimalSession(),
        turns: [{ blocks: [], id: 'turn-1', index: 0, role: 'user', unexpected: true }],
      },
    }],
    ['/api/export', {
      session: {
        ...createMinimalSession(),
        turns: [{
          blocks: [{ id: 'block-1', text: 'demo', type: 'text', unexpected: true }],
          id: 'turn-1',
          index: 0,
          role: 'user',
        }],
      },
    }],
    ['/api/export', {
      options: { includeThinking: true, unexpected: true },
      session: createMinimalSession(),
    }],
    ['/api/export', {
      session: {
        ...createMinimalSession(),
        bookmarks: [{ id: 'bookmark-1', label: 'Start', turnIndex: 0, unexpected: true }],
      },
    }],
    ['/api/export', {
      session: {
        ...createMinimalSession(),
        stats: { turnCount: 0, unexpected: true },
      },
    }],
  ] as const)('rejects unknown request keys for %s', async (path, body) => {
    const sessionSource = createSessionSource()
    const handler = createApiHandler({ sessionSource })
    const response = await handler(jsonRequest(path, body))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(invalidRequestError)
    expect(sessionSource.loadSession).not.toHaveBeenCalled()
    expect(sessionSource.searchSessions).not.toHaveBeenCalled()
  })

  it('preserves invalid_query for a blank search query', async () => {
    const sessionSource = createSessionSource()
    const handler = createApiHandler({ sessionSource })
    const response = await handler(jsonRequest('/api/search', { query: '   ' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'invalid_query', message: 'Search query must not be empty' },
    })
    expect(sessionSource.searchSessions).not.toHaveBeenCalled()
  })

  it('accepts valid load and search requests', async () => {
    const sessionSource = createSessionSource()
    const handler = createApiHandler({ sessionSource })

    expect((await handler(jsonRequest('/api/load', { sessionId: 'session-1' }))).status).toBe(200)
    expect((await handler(jsonRequest('/api/search', { limit: 5, query: '  demo  ' }))).status).toBe(200)
    expect(sessionSource.loadSession).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(sessionSource.searchSessions).toHaveBeenCalledWith({ limit: 5, query: 'demo' })
  })

  it('preserves path precedence when both load selectors are valid', async () => {
    const sessionSource = createSessionSource()
    const handler = createApiHandler({ homeDirectory: '/tmp', sessionSource })
    const response = await handler(jsonRequest('/api/load', { path: '/tmp', sessionId: 'session-1' }))

    expect(response.status).toBe(200)
    expect(sessionSource.loadSession).toHaveBeenCalledWith({
      path: '/tmp',
      sessionId: 'session-1',
    })
  })

  it('accepts a valid minimal export request', async () => {
    const handler = createApiHandler({ sessionSource: createSessionSource() })
    const response = await handler(jsonRequest('/api/export', { session: createMinimalSession() }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('<!doctype html>')
  })

  it('accepts a maximal valid export request', async () => {
    const handler = createApiHandler({ sessionSource: createSessionSource() })
    const response = await handler(jsonRequest('/api/export', {
      options: {
        autoplayDelayMs: 750,
        exportTitle: 'Complete export',
        includeThinking: true,
        includeToolCalls: true,
        initialTurnIndex: 0,
        keepTimestamps: true,
        revealThinking: true,
      },
      session: {
        bookmarks: [{ id: 'bookmark-1', label: 'Start', turnIndex: 0 }],
        cwd: '/tmp/demo',
        description: 'Complete request fixture',
        id: 'session-1',
        project: 'demo-project',
        source: 'codex',
        startedAt: '2026-07-14T12:00:00.000Z',
        stats: {
          assistantTurnCount: 1,
          toolCallCount: 1,
          turnCount: 1,
          userTurnCount: 0,
        },
        summary: 'Complete export fixture',
        title: 'Demo session',
        turns: [{
          blocks: [
            {
              id: 'text-1',
              language: 'markdown',
              text: 'Export body',
              title: 'Body',
              type: 'markdown',
            },
            {
              id: 'tool-1',
              input: { command: 'echo demo' },
              isError: false,
              name: 'Bash',
              output: 'demo',
              resultTimestamp: '2026-07-14T12:00:02.000Z',
              status: 'completed',
              timestamp: '2026-07-14T12:00:01.000Z',
              title: 'Run command',
              type: 'tool',
            },
          ],
          id: 'turn-1',
          included: true,
          index: 0,
          label: 'Opening turn',
          role: 'assistant',
          timestamp: '2026-07-14T12:00:00.000Z',
        }],
        updatedAt: '2026-07-14T12:00:03.000Z',
      },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toContain('<title>Complete export</title>')
  })
})
