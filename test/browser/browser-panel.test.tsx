import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPanel, type SessionSummary } from '../../src/features/browser/BrowserPanel'

const sessions: SessionSummary[] = [
  {
    id: 'claude-1',
    provider: 'Claude Code',
    project: 'session-replay',
    title: 'Claude planning session',
    cwd: '/repo',
    updatedAt: 'Today',
    turnCount: 12,
  },
  {
    id: 'codex-1',
    provider: 'Codex',
    project: 'session-replay',
    title: 'Codex refactor session',
    cwd: '/repo',
    updatedAt: 'Yesterday',
    turnCount: 8,
  },
]

describe('BrowserPanel', () => {
  it('expands the search field from the icon button and clears it when dismissed', async () => {
    const user = userEvent.setup()
    const onSearchTextChange = vi.fn()

    function ControlledBrowserPanel() {
      const [searchText, setSearchText] = React.useState('')

      return (
        <BrowserPanel
          sessions={sessions}
          selectedSessionId={null}
          searchText={searchText}
          onSearchTextChange={(value) => {
            onSearchTextChange(value)
            setSearchText(value)
          }}
          onSelectSession={vi.fn()}
          onRefresh={vi.fn()}
        />
      )
    }

    render(<ControlledBrowserPanel />)

    const openSearchButton = screen.getByRole('button', { name: /^search sessions$/i })
    await user.click(openSearchButton)

    const searchInput = screen.getByRole('textbox', { name: /search sessions/i })
    expect(searchInput).toHaveFocus()

    await user.type(searchInput, 'codex')

    expect(onSearchTextChange).toHaveBeenNthCalledWith(1, 'c')
    expect(onSearchTextChange).toHaveBeenLastCalledWith('codex')

    await user.keyboard('{Escape}')

    expect(onSearchTextChange).toHaveBeenLastCalledWith('')
  })

  it('marks the refresh button busy while a refresh is in progress', () => {
    render(
      <BrowserPanel
        sessions={sessions}
        selectedSessionId={null}
        searchText=""
        onSearchTextChange={vi.fn()}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        refreshing
      />,
    )

    expect(screen.getByRole('button', { name: /refresh sessions/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('keeps refresh busy long enough to show manual refresh feedback', async () => {
    const user = userEvent.setup()
    let resolveRefresh: (() => void) | null = null

    render(
      <BrowserPanel
        sessions={sessions}
        selectedSessionId={null}
        searchText=""
        onSearchTextChange={vi.fn()}
        onSelectSession={vi.fn()}
        onRefresh={() =>
          new Promise<void>((resolve) => {
            resolveRefresh = resolve
          })
        }
      />,
    )

    const refreshButton = screen.getByRole('button', { name: /refresh sessions/i })

    await user.click(refreshButton)
    expect(refreshButton).toHaveAttribute('aria-busy', 'true')

    resolveRefresh?.()
    await waitFor(() => {
      expect(refreshButton).toHaveAttribute('aria-busy', 'false')
    })
  })

  it('lets users collapse and expand provider groups', async () => {
    const user = userEvent.setup()

    render(
      <BrowserPanel
        sessions={sessions}
        selectedSessionId={null}
        searchText=""
        onSearchTextChange={vi.fn()}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    const claudeGroupTrigger = screen.getByRole('button', { name: /claude code/i })

    expect(claudeGroupTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /claude planning session/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /codex refactor session/i })).toBeInTheDocument()

    await user.click(claudeGroupTrigger)

    expect(claudeGroupTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /claude planning session/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /codex refactor session/i })).toBeInTheDocument()

    await user.click(claudeGroupTrigger)

    expect(claudeGroupTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /claude planning session/i })).toBeInTheDocument()
  })
})
