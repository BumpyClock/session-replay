import { describe, expect, it, vi } from 'vitest'
import { createApiHandler } from '../../server/api/handler'
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
  it('returns discovered sessions from GET /api/sessions', async () => {
    const listSessions = vi.fn().mockResolvedValue([createFixtureSessionRef()])
    const sessionSource: SessionSource = {
      listSessions,
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
})
