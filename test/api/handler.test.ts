import { describe, expect, it, vi } from 'vitest'
import { createApiHandler } from '../../server/api/handler'
import { API_HEALTH_PATH } from '../../server/api/routes'
import type { SessionSource } from '../../server/api/session-source'

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
})
