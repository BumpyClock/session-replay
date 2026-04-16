import React from 'react'
import { act } from '@testing-library/react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReplayPanel, type ReplaySession } from '../../src/features/preview/ReplayPanel'
import { prepareTranscriptLayout } from '../../src/lib/replay/transcript-layout'

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

const sessionLayout = prepareTranscriptLayout(session.turns)

describe('ReplayPanel', () => {
  it('keeps newly loaded sessions pinned to the top instead of jumping to the end', () => {
    const animationFrames: FrameRequestCallback[] = []
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame

    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = vi.fn()

    try {
      const { container } = render(
        <ReplayPanel
          canExport
          layout={sessionLayout}
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

      const content = container.querySelector('.preview-block__content--chat') as HTMLDivElement
      const scrollTo = vi.fn()
      Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 640 })
      content.scrollTo = scrollTo

      act(() => {
        animationFrames.splice(0).forEach((callback) => callback(0))
      })

      expect(scrollTo).toHaveBeenCalledWith({
        behavior: 'auto',
        top: 0,
      })
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })

  it('renders a single refined empty state when no session is selected', () => {
    render(
      <ReplayPanel
        canExport
        onExport={vi.fn()}
        session={null}
        totalCount={0}
        visibleCount={0}
        onBookmarkChange={vi.fn()}
        onOpenExportSettings={vi.fn()}
        onOpenPreview={vi.fn()}
        onToggleTurnIncluded={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Preview ready' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Choose a session from the library' })).toBeInTheDocument()
    expect(
      screen.getByText('Open any conversation in the browser rail to inspect tool calls, thinking blocks, and timeline turns.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('0/0 visible')).not.toBeInTheDocument()
    expect(screen.queryByText('Replay preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('renders editor surface with bookmark editing, turn visibility, and export controls', () => {
    const onBookmarkChange = vi.fn()
    const onExport = vi.fn()
    const onOpenExportSettings = vi.fn()
    const onOpenPreview = vi.fn()
    const onStartPlayback = vi.fn()
    const onToggleTurnIncluded = vi.fn()
    const { container } = render(
      <ReplayPanel
        canExport
        layout={sessionLayout}
        onExport={onExport}
        session={session}
        totalCount={3}
        visibleCount={2}
        onBookmarkChange={onBookmarkChange}
        onOpenExportSettings={onOpenExportSettings}
        onOpenPreview={onOpenPreview}
        onStartPlayback={onStartPlayback}
        onToggleTurnIncluded={onToggleTurnIncluded}
      />,
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Session editor' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('bullet')).toBeInTheDocument()
    expect(screen.getAllByText('Need review replay UX.').length).toBeGreaterThan(0)
    expect(screen.getByText('Skill context')).toBeInTheDocument()
    expect(screen.getByText('ux-designer')).toBeInTheDocument()
    expect(screen.getByText('3 turns')).toBeInTheDocument()
    expect(screen.queryByText('Replay preview')).not.toBeInTheDocument()
    expect(screen.getByText('ASSISTANT:')).toBeInTheDocument()
    expect(screen.getByText('Keep this tool result')).toBeInTheDocument()
    expect(screen.getByText('Hidden from preview + export')).toBeInTheDocument()
    expect(screen.getByText('1 text, 1 thinking, 1 tool call')).toBeInTheDocument()
    expect(screen.getByText('07:04 AM')).toBeInTheDocument()
    expect(screen.getByText('completed · src/App.tsx')).toBeInTheDocument()

    // Editor toolbar has play, preview, export, and settings — no step/speed controls
    const toolbar = screen.getByRole('toolbar', { name: 'Editor controls' })
    expect(within(toolbar).getByRole('button', { name: 'Play transcript' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Open export settings' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: 'Previous step' })).not.toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: 'Next step' })).not.toBeInTheDocument()
    expect(within(toolbar).queryByRole('button', { name: /Playback speed/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument()

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

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Play transcript' }))
    expect(onStartPlayback).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit bookmark note' })[0])
    const noteInput = screen.getByLabelText('Bookmark note for turn-1')
    fireEvent.change(noteInput, { target: { value: 'Flag this answer' } })
    fireEvent.keyDown(noteInput, { key: 'Enter' })
    expect(onBookmarkChange).toHaveBeenCalledWith('turn-1', 'Flag this answer')

    fireEvent.click(screen.getAllByRole('button', { name: 'Hide turn from preview and export' })[0])
    expect(onToggleTurnIncluded).toHaveBeenCalledWith('turn-0')
  })

  it('shows all turns including hidden turns in editor mode', () => {
    const { container } = render(
      <ReplayPanel
        canExport
        layout={sessionLayout}
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

    // Editor always displays all turns — including hidden ones
    expect(container.querySelectorAll('.replay-turn')).toHaveLength(3)
    expect(screen.getByText('Hidden from preview + export')).toBeInTheDocument()
  })
})
