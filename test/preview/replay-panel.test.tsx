import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReplayPanel, type ReplaySession } from '../../src/features/preview/ReplayPanel'

const session: ReplaySession = {
  cwd: '/repo',
  id: 'session-1',
  project: 'session-replay',
  provider: 'Codex',
  title: 'Markdown preview',
  turnCount: 1,
  turns: [
    {
      blocks: [
        {
          id: 'block-1',
          text: '## Heading\n\n- bullet',
          type: 'markdown',
        },
        {
          id: 'block-2',
          text: 'Private chain of thought',
          type: 'thinking',
        },
        {
          id: 'tool-1',
          type: 'tool',
          name: 'Read',
          input: '{\n  "file_path": "src/App.tsx"\n}',
          output: 'file contents',
          status: 'completed',
        },
      ],
      id: 'turn-1',
      role: 'assistant',
      summary: '1 text, 1 thinking, 1 tool call',
      timeLabel: '07:04 AM',
      timestamp: '2026-04-13T07:04:00.000Z',
    },
  ],
  updatedAt: '2026-04-13T07:04:00.000Z',
}

describe('ReplayPanel', () => {
  it('renders markdown html inside session playback cards', () => {
    const { container } = render(<ReplayPanel session={session} totalCount={1} visibleCount={1} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('bullet')).toBeInTheDocument()
    expect(screen.getByText('1 text, 1 thinking, 1 tool call')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument()
    expect(screen.getByText('completed · file contents')).toBeInTheDocument()

    const details = container.querySelectorAll('details')
    expect(details[0]).toHaveAttribute('open')
    expect(details[1]).toHaveAttribute('open')
    expect(details[2]).not.toHaveAttribute('open')
    expect(details[3]).not.toHaveAttribute('open')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    details.forEach((detail) => expect(detail).not.toHaveAttribute('open'))

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    details.forEach((detail) => expect(detail).toHaveAttribute('open'))
  })
})
