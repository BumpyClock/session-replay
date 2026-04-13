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
  })
})
