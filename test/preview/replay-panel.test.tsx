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
    expect(screen.queryByRole('toolbar', { name: 'Playback controls' })).not.toBeInTheDocument()
  })

  it('renders markdown html inside session playback cards', () => {
    const onBookmarkChange = vi.fn()
    const onExport = vi.fn()
    const onOpenExportSettings = vi.fn()
    const onOpenPreview = vi.fn()
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
        onToggleTurnIncluded={onToggleTurnIncluded}
      />,
    )

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

  it('keeps future turn headers mounted during playback while their bodies stay unrevealed', () => {
    const playbackScrollSession: ReplaySession = {
      ...session,
      turnCount: 4,
      turns: [
        session.turns[0],
        session.turns[1],
        {
          blocks: [
            {
              id: 'turn-3-user',
              text: 'Future question body',
              type: 'text',
            },
          ],
          id: 'turn-3',
          role: 'user',
          summary: 'Future follow-up question',
          timeLabel: '07:06 AM',
          timestamp: '2026-04-13T07:06:00.000Z',
        },
        {
          blocks: [
            {
              id: 'turn-4-text',
              text: 'Future answer body',
              type: 'text',
            },
          ],
          id: 'turn-4',
          role: 'assistant',
          summary: 'Future answer summary',
          timeLabel: '07:07 AM',
          timestamp: '2026-04-13T07:07:00.000Z',
        },
      ],
      updatedAt: '2026-04-13T07:07:00.000Z',
    }

    const { container } = render(
      <ReplayPanel
        canExport
        layout={prepareTranscriptLayout(playbackScrollSession.turns)}
        onExport={vi.fn()}
        session={playbackScrollSession}
        totalCount={4}
        visibleCount={4}
        onBookmarkChange={vi.fn()}
        onOpenExportSettings={vi.fn()}
        onOpenPreview={vi.fn()}
        onToggleTurnIncluded={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Play transcript' }))

    expect(screen.getByText('Future follow-up question')).toBeInTheDocument()
    expect(screen.getByText('Future answer summary')).toBeInTheDocument()
    expect(screen.queryByText('Future question body')).not.toBeInTheDocument()
    expect(screen.queryByText('Future answer body')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.replay-turn__body--placeholder')).toHaveLength(3)
  })

  it('lets users scroll up during playback without snapping back to the active turn', async () => {
    vi.useFakeTimers()

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
      Object.defineProperty(content, 'scrollTop', { configurable: true, value: 0, writable: true })
      content.scrollTo = scrollTo
      Object.defineProperty(content, 'clientHeight', { configurable: true, value: 320 })
      Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 960 })

      const flushAnimationFrames = () => {
        act(() => {
          while (animationFrames.length > 0) {
            const pending = animationFrames.splice(0)
            pending.forEach((callback) => callback(0))
          }
        })
      }

      flushAnimationFrames()
      fireEvent.click(screen.getByRole('button', { name: 'Play transcript' }))
      flushAnimationFrames()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      flushAnimationFrames()

      const scrollCallCountBeforeManualScroll = scrollTo.mock.calls.length
      content.scrollTop = 0
      fireEvent.scroll(content)

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      flushAnimationFrames()

      expect(scrollTo).toHaveBeenCalledTimes(scrollCallCountBeforeManualScroll)
      expect(screen.getByRole('button', { name: 'Pause playback' })).toBeInTheDocument()
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
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
      const toolRunLayout = prepareTranscriptLayout(toolRunSession.turns)
      const { container } = render(
        <ReplayPanel
          canExport
          layout={toolRunLayout}
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
