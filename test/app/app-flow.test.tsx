import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_FILTERS, browserPrefsStore } from '../../src/lib/browser/store'

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
    browserPrefsStore.setState({
      collapsedProjectIds: [],
      filters: DEFAULT_FILTERS,
      ignoredProjectIds: [],
      pinnedProjectIds: [],
    })
    localStorageMock.clear()
    localStorageMock.getItem.mockReset()
    localStorageMock.getItem.mockReturnValue(null)
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
    expect(screen.queryByText('Select session to begin')).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(loadSessionMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(previewSessionMock).toHaveBeenCalled())

    expect(screen.getByRole('heading', { name: 'Session playback' })).toBeInTheDocument()
    expect(screen.getByText('assistant message')).toBeInTheDocument()
    expect(screen.queryByTitle('Replay export preview')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByTitle('Replay export preview')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /close export preview/i }))
    await user.click(screen.getByRole('button', { name: /open export settings/i }))
    expect(await screen.findByText(/local and read-only in the resulting bundle/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /close export settings/i }))

    await user.click(screen.getAllByRole('button', { name: 'Export' })[0])
    await waitFor(() => expect(exportSessionDocumentMock).toHaveBeenCalledTimes(1))
  }, 15000)

  it('does not rerender preview on unrelated app rerenders', async () => {
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

    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: /sample session/i })
    await user.click(screen.getByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(previewSessionMock).toHaveBeenCalled())
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    const settledPreviewCalls = previewSessionMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: /search sessions/i }))
    await user.type(screen.getByRole('textbox'), 'sample')

    await waitFor(() => expect(previewSessionMock).toHaveBeenCalledTimes(settledPreviewCalls))
  })

  it('filters the sidebar without rerendering the loaded preview', async () => {
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
        {
          id: 'session-2',
          source: 'copilot',
          path: '/tmp/session-2.jsonl',
          title: 'Copilot session',
          project: 'other-project',
          updatedAt: '2026-04-12T10:00:00.000Z',
          startedAt: null,
          cwd: null,
          stats: {
            turnCount: 2,
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

    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: /sample session/i })
    expect(screen.getByRole('button', { name: /copilot session/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(previewSessionMock).toHaveBeenCalled())
    const settledPreviewCalls = previewSessionMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: /filter sessions/i }))
    const filterPanel = screen.getByText(/session filters/i).closest('article') as HTMLElement
    await user.click(within(filterPanel).getByRole('button', { name: /sample-project/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /copilot session/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /sample session/i })).toBeInTheDocument()
    expect(previewSessionMock).toHaveBeenCalledTimes(settledPreviewCalls)
  })

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
