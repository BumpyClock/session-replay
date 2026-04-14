import React from 'react'
import { act } from '@testing-library/react'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
    const onExport = vi.fn()
    const onOpenExportSettings = vi.fn()
    const onOpenPreview = vi.fn()
    const onToggleTurnIncluded = vi.fn()
    const { container } = render(
      <ReplayPanel
        canExport
        onExport={onExport}
        session={session}
        totalCount={3}
        visibleCount={2}
        onBookmarkChange={onBookmarkChange}
        onOpenExportSettings={onOpenExportSettings}
        onOpenPreview={onOpenPreview}
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
    const toolbar = screen.getByRole('toolbar', { name: 'Playback controls' })
    expect(within(toolbar).getByRole('button', { name: 'Play transcript' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Previous step' })).toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: 'Next step' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Playback speed 4x' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Open export settings' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument()
    expect(screen.getByText('completed · src/App.tsx')).toBeInTheDocument()

    const details = container.querySelectorAll('details')
    expect(details[0]).not.toHaveAttribute('open')
    expect(details[1]).not.toHaveAttribute('open')
    expect(details[2]).not.toHaveAttribute('open')

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Open export settings' }))
    expect(onOpenExportSettings).toHaveBeenCalledTimes(1)

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Preview' }))
    expect(onOpenPreview).toHaveBeenCalledTimes(1)

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Export' }))
    expect(onExport).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit bookmark note' })[0])
    const noteInput = screen.getByLabelText('Bookmark note for turn-1')
    fireEvent.change(noteInput, { target: { value: 'Flag this answer' } })
    fireEvent.keyDown(noteInput, { key: 'Enter' })
    expect(onBookmarkChange).toHaveBeenCalledWith('turn-1', 'Flag this answer')

    fireEvent.click(screen.getAllByRole('button', { name: 'Hide turn from preview and export' })[0])
    expect(onToggleTurnIncluded).toHaveBeenCalledWith('turn-0')
  })

  it('reveals assistant content progressively while playback runs', async () => {
    vi.useFakeTimers()

    try {
      render(
        <ReplayPanel
          canExport
          onExport={vi.fn()}
          session={session}
          totalCount={3}
          visibleCount={2}
          onBookmarkChange={vi.fn()}
          onOpenExportSettings={vi.fn()}
          onOpenPreview={vi.fn()}
          onToggleTurnIncluded={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Play transcript' }))

      expect(screen.getByRole('button', { name: 'Pause playback' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled()
      expect(screen.queryByRole('heading', { level: 2, name: 'Heading' })).not.toBeInTheDocument()
      expect(screen.queryByText('completed · src/App.tsx')).not.toBeInTheDocument()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByRole('button', { name: 'Previous step' })).toBeEnabled()
      expect(screen.queryByRole('heading', { level: 2, name: 'Heading' })).not.toBeInTheDocument()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument()
      expect(screen.queryByText('completed · src/App.tsx')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('groups short sequential tool calls into one block and appends new calls during playback', async () => {
    vi.useFakeTimers()

    const toolRunSession: ReplaySession = {
      ...session,
      turns: [
        session.turns[0],
        {
          ...session.turns[1],
          blocks: [
            {
              id: 'tool-run-1',
              type: 'tool',
              name: 'Read',
              input: { file_path: 'src/App.tsx' },
              output: 'first result',
              status: 'completed',
            },
            {
              id: 'tool-run-2',
              type: 'tool',
              name: 'Bash',
              input: { command: 'echo ok' },
              output: 'second result',
              status: 'completed',
            },
          ],
          summary: '2 tool calls',
        },
      ],
    }

    try {
      const { container } = render(
        <ReplayPanel
          canExport
          onExport={vi.fn()}
          session={toolRunSession}
          totalCount={2}
          visibleCount={2}
          onBookmarkChange={vi.fn()}
          onOpenExportSettings={vi.fn()}
          onOpenPreview={vi.fn()}
          onToggleTurnIncluded={vi.fn()}
        />,
      )

      expect(container.querySelectorAll('.replay-tool-group')).toHaveLength(1)
      expect(container.querySelector('.replay-tool-group__label')?.textContent).toBe('2 tool calls')

      fireEvent.click(screen.getByRole('button', { name: 'Play transcript' }))

      expect(screen.queryByText('Tool: Read')).not.toBeInTheDocument()
      expect(screen.queryByText('Tool: Bash')).not.toBeInTheDocument()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(container.querySelectorAll('.replay-tool-group')).toHaveLength(0)
      expect(screen.queryByText('Tool: Read')).not.toBeInTheDocument()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(container.querySelectorAll('.replay-tool-group')).toHaveLength(1)
      expect(container.querySelector('.replay-tool-group__label')?.textContent).toBe('Tool: Read')
      expect(container.querySelectorAll('.replay-disclosure--tool')).toHaveLength(1)
      expect(screen.queryByText('Tool: Bash')).not.toBeInTheDocument()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(container.querySelectorAll('.replay-tool-group')).toHaveLength(1)
      expect(container.querySelector('.replay-tool-group__label')?.textContent).toBe('2 tool calls')
      expect(container.querySelectorAll('.replay-disclosure--tool')).toHaveLength(2)
      expect(screen.getByText('Tool: Bash')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
