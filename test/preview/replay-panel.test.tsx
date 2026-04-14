import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
          id: 'user-skill-context',
          text: [
            'Need review replay UX.',
            '',
            '<skill-context name="ux-designer">',
            'Base directory for this skill: /skills/ux-designer',
            '',
            'Related files (use view tool to read):',
            '  - /skills/ux-designer/design-direction.md',
            '  - /skills/ux-designer/interaction-visual-clarity.md',
            '',
            '---',
            'name: ux-designer',
            'description: Create UX design documentation, layout specs, interaction flows, and style guides.',
            'context: fork',
            '---',
            '',
            '# Core Workflow',
            '',
            '## Design Direction',
            '</skill-context>',
          ].join('\n'),
          type: 'text',
        },
      ],
      id: 'turn-0',
      role: 'user',
      summary: 'Need review replay UX.',
      timeLabel: '07:03 AM',
      timestamp: '2026-04-13T07:03:00.000Z',
    },
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
          input: { file_path: 'src/App.tsx' },
          output: 'file contents',
          status: 'completed',
        },
      ],
      id: 'turn-1',
      bookmarkLabel: 'Keep this tool result',
      isBookmarked: true,
      role: 'assistant',
      summary: '1 text, 1 thinking, 1 tool call',
      timeLabel: '07:04 AM',
      timestamp: '2026-04-13T07:04:00.000Z',
    },
    {
      blocks: [
        {
          id: 'turn-2-user',
          text: 'Hidden turn body',
          type: 'text',
        },
      ],
      id: 'turn-2',
      isHidden: true,
      previewText: 'Hidden turn body',
      role: 'user',
      summary: 'Hidden turn body',
      timeLabel: '07:05 AM',
      timestamp: '2026-04-13T07:05:00.000Z',
    },
  ],
  updatedAt: '2026-04-13T07:04:00.000Z',
}

describe('ReplayPanel', () => {
  it('renders markdown html inside session playback cards', () => {
    const onBookmarkChange = vi.fn()
    const onToggleTurnIncluded = vi.fn()
    const { container } = render(
      <ReplayPanel
        session={session}
        totalCount={3}
        visibleCount={2}
        onBookmarkChange={onBookmarkChange}
        onToggleTurnIncluded={onToggleTurnIncluded}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('bullet')).toBeInTheDocument()
    expect(screen.getAllByText('Need review replay UX.').length).toBeGreaterThan(0)
    expect(screen.getByText('Skill context')).toBeInTheDocument()
    expect(screen.getByText('ux-designer')).toBeInTheDocument()
    expect(screen.getByText('ASSISTANT:')).toBeInTheDocument()
    expect(screen.getByText('Keep this tool result')).toBeInTheDocument()
    expect(screen.getByText('Hidden from preview + export')).toBeInTheDocument()
    expect(screen.getByText('1 text, 1 thinking, 1 tool call')).toBeInTheDocument()
    expect(screen.getByText('07:04 AM')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument()
    expect(screen.getByText('completed · src/App.tsx')).toBeInTheDocument()

    const details = container.querySelectorAll('details')
    expect(details[0]).not.toHaveAttribute('open')
    expect(details[1]).not.toHaveAttribute('open')
    expect(details[2]).not.toHaveAttribute('open')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    details.forEach((detail) => expect(detail).not.toHaveAttribute('open'))

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    details.forEach((detail) => expect(detail).toHaveAttribute('open'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit bookmark note' })[0])
    const noteInput = screen.getByLabelText('Bookmark note for turn-1')
    fireEvent.change(noteInput, { target: { value: 'Flag this answer' } })
    fireEvent.keyDown(noteInput, { key: 'Enter' })
    expect(onBookmarkChange).toHaveBeenCalledWith('turn-1', 'Flag this answer')

    fireEvent.click(screen.getAllByRole('button', { name: 'Hide turn from preview and export' })[0])
    expect(onToggleTurnIncluded).toHaveBeenCalledWith('turn-0')
  })
})
