import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { listSessionsMock, loadSessionMock, previewSessionMock, exportSessionDocumentMock } =
  vi.hoisted(() => ({
    listSessionsMock: vi.fn(),
    loadSessionMock: vi.fn(),
    previewSessionMock: vi.fn(),
    exportSessionDocumentMock: vi.fn(),
  }))

const localStorageMock = {
  clear: vi.fn(),
  getItem: vi.fn(),
  key: vi.fn(),
  length: 0,
  removeItem: vi.fn(),
  setItem: vi.fn(),
}

vi.mock('../../src/lib/api/client', () => ({
  createSessionReplayApiClient: () => ({
    exportSessionDocument: exportSessionDocumentMock,
    listSessions: listSessionsMock,
    loadSession: loadSessionMock,
    previewSession: previewSessionMock,
    searchSessions: vi.fn(),
  }),
}))

describe('App flow', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    })
    localStorageMock.clear()
    localStorageMock.getItem.mockReset()
    localStorageMock.key.mockReset()
    localStorageMock.removeItem.mockReset()
    localStorageMock.setItem.mockReset()
    listSessionsMock.mockReset()
    loadSessionMock.mockReset()
    previewSessionMock.mockReset()
    exportSessionDocumentMock.mockReset()
  })

it('loads a session, renders preview state, and exports html', async () => {
    listSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: 'session-1',
          source: 'claude-code',
          path: '/tmp/session-1.jsonl',
          title: 'Sample session',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:00:00.000Z',
          startedAt: null,
          cwd: null,
          stats: {
            turnCount: 1,
          },
        },
      ],
    })

    loadSessionMock.mockResolvedValue({
      session: {
        id: 'session-1',
        title: 'Sample session',
        source: 'claude-code',
        project: 'sample-project',
        cwd: '/repo',
        summary: 'sample',
        startedAt: '2026-04-13T10:00:00.000Z',
        updatedAt: '2026-04-13T10:00:00.000Z',
        turns: [
          {
            id: 'turn-1',
            index: 0,
            role: 'assistant',
            timestamp: '2026-04-13T10:00:00.000Z',
            included: true,
            blocks: [
              {
                id: 'block-1',
                type: 'text',
                text: 'assistant message',
              },
            ],
          },
        ],
      },
    })
    previewSessionMock.mockResolvedValue({ html: '<div data-testid="preview">preview</div>' })
    exportSessionDocumentMock.mockResolvedValue('<html>export</html>')

    const { default: App } = await import('../../src/App')

    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
    await screen.findByRole('button', { name: /sample session/i })

    await user.click(await screen.findByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(loadSessionMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(previewSessionMock).toHaveBeenCalled())

    expect(await screen.findByRole('heading', { name: /Sample session/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Session playback' })).toBeInTheDocument()
    expect(screen.getByText(/local and read-only in the resulting bundle/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Generate one-file html/i }))
    await waitFor(() => expect(exportSessionDocumentMock).toHaveBeenCalledTimes(1))
  }, 15000)

  it('shows a non-fatal catalog warning when some sessions are skipped', async () => {
    listSessionsMock.mockResolvedValue({
      sessions: [],
      warnings: [
        {
          code: 'catalog_index_failed',
          filePath: '/tmp/broken.json',
          message: 'Failed to index gemini session',
        },
      ],
    })

    const { default: App } = await import('../../src/App')

    render(<App />)

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(/1 session was skipped during catalog refresh/i),
    ).toBeInTheDocument()
  })

  it('shows catalog indexing progress in the sidebar summary', async () => {
    listSessionsMock.mockResolvedValue({
      catalog: {
        discoveredCount: 10,
        indexedCount: 3,
        pendingCount: 7,
        snapshotAt: '2026-04-13T10:00:00.000Z',
        stale: false,
        state: 'indexing',
      },
      sessions: [],
    })

    const { default: App } = await import('../../src/App')

    render(<App />)

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/0 sessions loaded · indexing 3\/10/i)).toBeInTheDocument()
  })

  it('polls while catalog indexing and refreshes session titles when indexing finishes', async () => {
    listSessionsMock
      .mockResolvedValueOnce({
        catalog: {
          discoveredCount: 1,
          indexedCount: 0,
          pendingCount: 1,
          snapshotAt: '2026-04-13T10:00:00.000Z',
          stale: false,
          state: 'indexing',
        },
        sessions: [
          {
            id: 'session-1',
            source: 'claude-code',
            path: '/tmp/session-1.jsonl',
            title: 'session-1',
            project: 'sample-project',
            updatedAt: '2026-04-13T10:00:00.000Z',
            startedAt: null,
            cwd: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        catalog: {
          discoveredCount: 1,
          indexedCount: 1,
          pendingCount: 0,
          snapshotAt: '2026-04-13T10:00:01.000Z',
          stale: false,
          state: 'ready',
        },
        sessions: [
          {
            id: 'session-1',
            source: 'claude-code',
            path: '/tmp/session-1.jsonl',
            title: 'Indexed session',
            project: 'sample-project',
            updatedAt: '2026-04-13T10:00:00.000Z',
            startedAt: null,
            cwd: null,
            stats: {
              turnCount: 2,
            },
          },
        ],
      })

    const { default: App } = await import('../../src/App')

    render(<App />)

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: /session-1/i })).toBeInTheDocument()

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2), { timeout: 2000 })
    expect(await screen.findByRole('button', { name: /indexed session/i })).toBeInTheDocument()
  }, 4000)

  it('keeps polling after a transient background refresh failure', async () => {
    listSessionsMock
      .mockResolvedValueOnce({
        catalog: {
          discoveredCount: 1,
          indexedCount: 0,
          pendingCount: 1,
          snapshotAt: '2026-04-13T10:00:00.000Z',
          stale: false,
          state: 'indexing',
        },
        sessions: [
          {
            id: 'session-1',
            source: 'claude-code',
            path: '/tmp/session-1.jsonl',
            title: 'session-1',
            project: 'sample-project',
            updatedAt: '2026-04-13T10:00:00.000Z',
            startedAt: null,
            cwd: null,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce({
        catalog: {
          discoveredCount: 1,
          indexedCount: 1,
          pendingCount: 0,
          snapshotAt: '2026-04-13T10:00:02.000Z',
          stale: false,
          state: 'ready',
        },
        sessions: [
          {
            id: 'session-1',
            source: 'claude-code',
            path: '/tmp/session-1.jsonl',
            title: 'Recovered session',
            project: 'sample-project',
            updatedAt: '2026-04-13T10:00:00.000Z',
            startedAt: null,
            cwd: null,
            stats: {
              turnCount: 2,
            },
          },
        ],
      })

    const { default: App } = await import('../../src/App')

    render(<App />)

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: /session-1/i })).toBeInTheDocument()

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(3), { timeout: 3500 })
    expect(await screen.findByRole('button', { name: /recovered session/i })).toBeInTheDocument()
  }, 5000)
})
