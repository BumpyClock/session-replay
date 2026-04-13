import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReplayPanel, type ReplaySession } from '../../src/features/preview/ReplayPanel'
import { renderReplayTurnBodyHtml } from '../../src/lib/markdown'

const session: ReplaySession = {
  cwd: '/repo',
  id: 'session-1',
  project: 'session-replay',
  provider: 'Codex',
  title: 'Markdown preview',
  turnCount: 1,
  turns: [
    {
      bodyHtml: renderReplayTurnBodyHtml({
        blocks: [
          {
            id: 'block-1',
            text: '## Heading\n\n- bullet',
            type: 'markdown',
          },
        ],
        toolCalls: [],
      }),
      id: 'turn-1',
      role: 'assistant',
      timeLabel: '07:04 AM',
      timestamp: '2026-04-13T07:04:00.000Z',
    },
  ],
  updatedAt: '2026-04-13T07:04:00.000Z',
}

describe('ReplayPanel', () => {
  it('renders markdown html inside session playback cards', () => {
    render(<ReplayPanel session={session} totalCount={1} visibleCount={1} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('bullet')).toBeInTheDocument()
  })
})
