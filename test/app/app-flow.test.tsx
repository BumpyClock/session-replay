import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MaterializedReplaySession, SessionLoadResponse } from '../../src/lib/api/contracts'
import { DEFAULT_FILTERS, browserPrefsStore } from '../../src/lib/browser/store'

const { listSessionsMock, loadSessionMock, exportSessionDocumentMock } =
  vi.hoisted(() => ({
    listSessionsMock: vi.fn(),
    loadSessionMock: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

vi.mock('../../src/lib/api/client', () => ({
  createSessionReplayApiClient: () => ({
    exportSessionDocument: exportSessionDocumentMock,
    listSessions: listSessionsMock,
    loadSession: loadSessionMock,
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
    exportSessionDocumentMock.mockReset()
  })

  it('loads a session, renders editor state, and exports html', async () => {
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
    exportSessionDocumentMock.mockResolvedValue('<html>export</html>')

    const { default: App } = await import('../../src/App')

    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
    await screen.findByRole('button', { name: /sample session/i })
    expect(screen.queryByText('Select session to begin')).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(loadSessionMock).toHaveBeenCalledTimes(1))

    expect(screen.getByRole('heading', { name: 'Session editor' })).toBeInTheDocument()
    expect(screen.getByText('assistant message')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open export settings/i }))
    expect(await screen.findByText(/local and read-only in the resulting bundle/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /close export settings/i }))

    await user.click(screen.getAllByRole('button', { name: 'Export' })[0])
    await waitFor(() => expect(exportSessionDocumentMock).toHaveBeenCalledTimes(1))
  }, 15000)

  it('keeps shared replay and export controls visible after entering playback mode', async () => {
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

    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: /sample session/i })
    await user.click(screen.getByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(loadSessionMock).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Play transcript' }))

    const toolbar = await screen.findByRole('toolbar', { name: 'Replay and export controls' })
    expect(within(toolbar).getByRole('button', { name: /Pause playback|Play transcript/ })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Previous step' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Next step' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /Playback speed/ })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Exit playback' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Open export settings' })).toBeInTheDocument()

    await user.click(within(toolbar).getByRole('button', { name: 'Open export settings' }))
    expect(await screen.findByText(/generated one-file replay/i)).toBeInTheDocument()
  })

  it('does not rerender the loaded session on unrelated app rerenders', async () => {
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
    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: /sample session/i })
    await user.click(screen.getByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(loadSessionMock).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: /search sessions/i }))
    await user.type(screen.getByRole('textbox'), 'sample')

    await waitFor(() => expect(loadSessionMock).toHaveBeenCalledTimes(1))
  })

  it('keeps the newest session when loads resolve out of order', async () => {
    listSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: 'session-a',
          source: 'claude-code',
          path: '/tmp/session-a.jsonl',
          title: 'Session A',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:00:00.000Z',
          startedAt: null,
        },
        {
          id: 'session-b',
          source: 'claude-code',
          path: '/tmp/session-b.jsonl',
          title: 'Session B',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:01:00.000Z',
          startedAt: null,
        },
      ],
    })
    const sessionA = deferred<SessionLoadResponse>()
    const sessionB = deferred<SessionLoadResponse>()
    loadSessionMock
      .mockReturnValueOnce(sessionA.promise)
      .mockReturnValueOnce(sessionB.promise)

    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /session a/i }))
    await user.click(screen.getByRole('button', { name: /session b/i }))
    expect(loadSessionMock).toHaveBeenCalledTimes(2)

    const firstSignal = loadSessionMock.mock.calls[0]?.[1] as AbortSignal | undefined
    const secondSignal = loadSessionMock.mock.calls[1]?.[1] as AbortSignal | undefined
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(firstSignal?.aborted).toBe(true)
    expect(secondSignal).toBeInstanceOf(AbortSignal)
    expect(secondSignal?.aborted).toBe(false)

    sessionB.resolve({ session: createLoadedSession('session-b', 'Session B', 'session B response') })
    await waitFor(() => expect(screen.getByText('session B response')).toBeInTheDocument())

    sessionA.resolve({ session: createLoadedSession('session-a', 'Session A', 'session A response') })
    await waitFor(() => expect(screen.queryByText('session A response')).not.toBeInTheDocument())
    expect(screen.getByText('session B response')).toBeInTheDocument()
  })

  it('ignores a stale load rejection after the newest session succeeds', async () => {
    listSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: 'session-a',
          source: 'claude-code',
          path: '/tmp/session-a.jsonl',
          title: 'Session A',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:00:00.000Z',
          startedAt: null,
        },
        {
          id: 'session-b',
          source: 'claude-code',
          path: '/tmp/session-b.jsonl',
          title: 'Session B',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:01:00.000Z',
          startedAt: null,
        },
      ],
    })
    const sessionA = deferred<SessionLoadResponse>()
    const sessionB = deferred<SessionLoadResponse>()
    loadSessionMock
      .mockReturnValueOnce(sessionA.promise)
      .mockReturnValueOnce(sessionB.promise)

    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /session a/i }))
    await user.click(screen.getByRole('button', { name: /session b/i }))

    await act(async () => {
      sessionB.resolve({ session: createLoadedSession('session-b', 'Session B', 'session B response') })
      await sessionB.promise
    })
    expect(screen.getByText('session B response')).toBeInTheDocument()

    await act(async () => {
      sessionA.reject(new Error('stale session A failure'))
      await expect(sessionA.promise).rejects.toThrow('stale session A failure')
    })

    expect(screen.queryByText('stale session A failure')).not.toBeInTheDocument()
    expect(screen.getByText('session B response')).toBeInTheDocument()
  })

  it('keeps loading while the newest session is pending after a stale load settles', async () => {
    listSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: 'session-a',
          source: 'claude-code',
          path: '/tmp/session-a.jsonl',
          title: 'Session A',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:00:00.000Z',
          startedAt: null,
        },
        {
          id: 'session-b',
          source: 'claude-code',
          path: '/tmp/session-b.jsonl',
          title: 'Session B',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:01:00.000Z',
          startedAt: null,
        },
      ],
    })
    const sessionA = deferred<SessionLoadResponse>()
    const sessionB = deferred<SessionLoadResponse>()
    loadSessionMock
      .mockReturnValueOnce(sessionA.promise)
      .mockReturnValueOnce(sessionB.promise)

    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /session a/i }))
    await user.click(screen.getByRole('button', { name: /session b/i }))

    await act(async () => {
      sessionA.resolve({ session: createLoadedSession('session-a', 'Session A', 'session A response') })
      await sessionA.promise
    })

    expect(screen.getByText('Loading selected session…')).toBeInTheDocument()
    expect(screen.queryByText('session A response')).not.toBeInTheDocument()

    await act(async () => {
      sessionB.resolve({ session: createLoadedSession('session-b', 'Session B', 'session B response') })
      await sessionB.promise
    })
    expect(screen.queryByText('Loading selected session…')).not.toBeInTheDocument()
    expect(screen.getByText('session B response')).toBeInTheDocument()
  })

  it('aborts the active session load when the app unmounts', async () => {
    listSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: 'session-a',
          source: 'claude-code',
          path: '/tmp/session-a.jsonl',
          title: 'Session A',
          project: 'sample-project',
          updatedAt: '2026-04-13T10:00:00.000Z',
          startedAt: null,
        },
      ],
    })
    const sessionA = deferred<SessionLoadResponse>()
    loadSessionMock.mockReturnValueOnce(sessionA.promise)

    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    const { unmount } = render(<App />)

    await user.click(await screen.findByRole('button', { name: /session a/i }))
    const signal = loadSessionMock.mock.calls[0]?.[1] as AbortSignal | undefined
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    unmount()

    expect(signal?.aborted).toBe(true)
    sessionA.resolve({ session: createLoadedSession('session-a', 'Session A', 'session A response') })
    await sessionA.promise
  })

  it('filters the sidebar without reloading the selected session', async () => {
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
    const { default: App } = await import('../../src/App')
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('button', { name: /sample session/i })
    expect(screen.getByRole('button', { name: /copilot session/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /sample session/i }))
    await waitFor(() => expect(loadSessionMock).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: /filter sessions/i }))
    const filterPanel = screen.getByText(/session filters/i).closest('article') as HTMLElement
    await user.click(within(filterPanel).getByRole('button', { name: /sample-project/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /copilot session/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /sample session/i })).toBeInTheDocument()
    expect(loadSessionMock).toHaveBeenCalledTimes(1)
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

function createLoadedSession(
  id: string,
  title: string,
  responseText: string,
): MaterializedReplaySession {
  return {
    id,
    title,
    source: 'claude-code',
    project: 'sample-project',
    cwd: '/repo',
    summary: title,
    startedAt: '2026-04-13T10:00:00.000Z',
    updatedAt: '2026-04-13T10:00:00.000Z',
    turns: [
      {
        id: `${id}-turn`,
        index: 0,
        role: 'assistant',
        included: true,
        blocks: [{ id: `${id}-block`, type: 'text', text: responseText }],
      },
    ],
  }
}
