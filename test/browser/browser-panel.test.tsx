import React from 'react'
import { render, screen } from '@testing-library/react'
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
