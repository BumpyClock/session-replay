import React from 'react'
import { act } from '@testing-library/react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlaybackSurface } from '../../src/features/playback/PlaybackSurface'
import type { ReplaySession } from '../../src/features/preview/ReplayPanel'
import { prepareTranscriptLayout } from '../../src/lib/replay/transcript-layout'

const session: ReplaySession = {
  cwd: '/repo',
  id: 'session-1',
  project: 'session-replay',
  provider: 'Codex',
  title: 'Markdown preview',
  turnCount: 3,
  turns: [
    {
      blocks: [
        {
          id: 'user-block',
          text: 'Need review replay UX.',
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

const layout = prepareTranscriptLayout(session.turns)

describe('PlaybackSurface', () => {
  it('auto-starts in playing mode and shows playback controls without editor affordances', () => {
    vi.useFakeTimers()
    try {
      render(
        <PlaybackSurface
          session={session}
          layout={layout}
          onExitPlayback={vi.fn()}
        />,
      )

      const toolbar = screen.getByRole('toolbar', { name: 'Playback controls' })
      expect(within(toolbar).getByRole('button', { name: 'Pause playback' })).toBeInTheDocument()
      expect(within(toolbar).getByRole('button', { name: 'Previous step' })).toBeInTheDocument()
      expect(within(toolbar).getByRole('button', { name: 'Next step' })).toBeInTheDocument()
      expect(within(toolbar).getByRole('button', { name: /Playback speed/ })).toBeInTheDocument()
      expect(within(toolbar).getByRole('button', { name: 'Exit playback' })).toBeInTheDocument()

      // No editor/export controls
      expect(within(toolbar).queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
      expect(within(toolbar).queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()
      expect(within(toolbar).queryByRole('button', { name: 'Open export settings' })).not.toBeInTheDocument()

      // No bookmark edit or hide/show buttons on rows
      expect(screen.queryByRole('button', { name: /Add bookmark note/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Edit bookmark note/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Hide turn from preview/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Show turn in preview/ })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides hidden turns and future turns during playback', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <PlaybackSurface
          session={session}
          layout={layout}
          onExitPlayback={vi.fn()}
        />,
      )

      // Initially only the first user turn is visible
      expect(container.querySelectorAll('.replay-turn')).toHaveLength(1)
      // Hidden turns never appear
      expect(screen.queryByText('Hidden turn body')).not.toBeInTheDocument()
      expect(screen.queryByText('Hidden from preview + export')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reveals assistant content one playback unit at a time', async () => {
    vi.useFakeTimers()
    try {
      render(
        <PlaybackSurface
          session={session}
          layout={layout}
          onExitPlayback={vi.fn()}
        />,
      )

      // Auto-starts playing — initially only user turn visible, no assistant content
      expect(screen.queryByRole('heading', { level: 2, name: 'Heading' })).not.toBeInTheDocument()
      expect(screen.queryByText('completed · src/App.tsx')).not.toBeInTheDocument()

      // First tick: assistant turn becomes active, but no units are revealed yet.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.queryByRole('heading', { level: 2, name: 'Heading' })).not.toBeInTheDocument()
      expect(screen.queryByText('completed · src/App.tsx')).not.toBeInTheDocument()

      // Second tick: first assistant unit appears.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByRole('heading', { level: 2, name: 'Heading' })).toBeInTheDocument()
      expect(screen.queryByText('completed · src/App.tsx')).not.toBeInTheDocument()

      // Later ticks reveal the remaining units.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByText('completed · src/App.tsx')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows bookmark labels as read-only callouts', async () => {
    vi.useFakeTimers()
    try {
      render(
        <PlaybackSurface
          session={session}
          layout={layout}
          onExitPlayback={vi.fn()}
        />,
      )

      // Advance to assistant turn
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // Bookmark label should be visible as a non-interactive span callout
      expect(screen.getByText('Keep this tool result')).toBeInTheDocument()
      expect(screen.getByLabelText('Bookmark note')).toBeInTheDocument()

      // But not as an interactive button
      const pill = screen.getByText('Keep this tool result').closest('.replay-turn__note-pill')
      expect(pill?.tagName).toBe('SPAN')
    } finally {
      vi.useRealTimers()
    }
  })

  it('calls onExitPlayback when exit button is clicked', () => {
    vi.useFakeTimers()
    try {
      const onExitPlayback = vi.fn()
      render(
        <PlaybackSurface
          session={session}
          layout={layout}
          onExitPlayback={onExitPlayback}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Exit playback' }))
      expect(onExitPlayback).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps future turns hidden until playback reaches them', () => {
    vi.useFakeTimers()

    const multiTurnSession: ReplaySession = {
      ...session,
      turnCount: 4,
      turns: [
        session.turns[0],
        session.turns[1],
        {
          blocks: [{ id: 'turn-3-user', text: 'Future question body', type: 'text' }],
          id: 'turn-3',
          role: 'user',
          summary: 'Future follow-up question',
          timeLabel: '07:06 AM',
          timestamp: '2026-04-13T07:06:00.000Z',
        },
        {
          blocks: [{ id: 'turn-4-text', text: 'Future answer body', type: 'text' }],
          id: 'turn-4',
          role: 'assistant',
          summary: 'Future answer summary',
          timeLabel: '07:07 AM',
          timestamp: '2026-04-13T07:07:00.000Z',
        },
      ],
      updatedAt: '2026-04-13T07:07:00.000Z',
    }

    try {
      const multiTurnLayout = prepareTranscriptLayout(multiTurnSession.turns)
      const { container } = render(
        <PlaybackSurface
          session={multiTurnSession}
          layout={multiTurnLayout}
          onExitPlayback={vi.fn()}
        />,
      )

      expect(screen.queryByText('Future follow-up question')).not.toBeInTheDocument()
      expect(screen.queryByText('Future answer summary')).not.toBeInTheDocument()
      expect(container.querySelectorAll('.replay-turn')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets users scroll during playback without snapping back to the active turn', async () => {
    vi.useFakeTimers()

    // Use a session with enough visible turns so playback does not complete
    // before the manual scroll interaction occurs.
    const multiTurnSession: ReplaySession = {
      ...session,
      turnCount: 4,
      turns: [
        session.turns[0],
        session.turns[1],
        {
          blocks: [{ id: 'turn-3-user', text: 'Follow-up question', type: 'text' }],
          id: 'turn-3',
          role: 'user',
          summary: 'Follow-up question',
          timeLabel: '07:06 AM',
          timestamp: '2026-04-13T07:06:00.000Z',
        },
        {
          blocks: [{ id: 'turn-4-text', text: 'Follow-up answer', type: 'text' }],
          id: 'turn-4',
          role: 'assistant',
          summary: 'Follow-up answer',
          timeLabel: '07:07 AM',
          timestamp: '2026-04-13T07:07:00.000Z',
        },
      ],
      updatedAt: '2026-04-13T07:07:00.000Z',
    }
    const multiTurnLayout = prepareTranscriptLayout(multiTurnSession.turns)

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
        <PlaybackSurface
          session={multiTurnSession}
          layout={multiTurnLayout}
          onExitPlayback={vi.fn()}
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

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      flushAnimationFrames()

      // Let the programmatic-scroll guard expire, then perform a genuine
      // user scroll that should detach auto-follow.
      await act(async () => {
        vi.advanceTimersByTime(151)
      })

      content.scrollTop = 0
      fireEvent.wheel(content)
      fireEvent.scroll(content)

      scrollTo.mockClear()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      flushAnimationFrames()

      scrollTo.mockClear()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      flushAnimationFrames()

      expect(scrollTo).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Pause playback' })).toBeInTheDocument()
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
      vi.useRealTimers()
    }
  })

  it('continues auto-scrolling while the active turn reveals more units', async () => {
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
        <PlaybackSurface
          session={session}
          layout={layout}
          onExitPlayback={vi.fn()}
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

      // Tick 1: assistant turn becomes active.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      flushAnimationFrames()

      scrollTo.mockClear()

      // Tick 2: first unit appears. Seed the active row geometry so we can
      // assert the auto-follow target.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      const activeTurn = container.querySelector('.replay-turn.is-playback-active') as HTMLLIElement
      Object.defineProperty(activeTurn, 'offsetTop', { configurable: true, value: 400 })
      Object.defineProperty(activeTurn, 'offsetHeight', { configurable: true, value: 240 })
      flushAnimationFrames()

      expect(scrollTo).toHaveBeenCalledTimes(1)
      expect(scrollTo).toHaveBeenLastCalledWith({
        behavior: 'auto',
        top: 480,
      })

      scrollTo.mockClear()

      // Tick 3: active assistant turn grows again. Auto-follow should run
      // again to keep the expanding row in view.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      Object.defineProperty(activeTurn, 'offsetHeight', { configurable: true, value: 300 })
      flushAnimationFrames()

      expect(scrollTo).toHaveBeenCalledTimes(1)
      expect(scrollTo).toHaveBeenLastCalledWith({
        behavior: 'auto',
        top: 540,
      })
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
      vi.useRealTimers()
    }
  })

  it('reveals grouped tool calls progressively within the active turn', async () => {
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
          bookmarkLabel: undefined,
          isBookmarked: false,
          summary: '2 tool calls',
        },
      ],
    }

    try {
      const toolRunLayout = prepareTranscriptLayout(toolRunSession.turns)
      const { container } = render(
        <PlaybackSurface
          session={toolRunSession}
          layout={toolRunLayout}
          onExitPlayback={vi.fn()}
        />,
      )

      // Initially only user turn visible, no assistant tool calls
      expect(screen.queryByText('Tool: Read')).not.toBeInTheDocument()
      expect(screen.queryByText('Tool: Bash')).not.toBeInTheDocument()

      // Tick 1: assistant turn becomes active, still no tool output.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.queryByText('Tool: Read')).not.toBeInTheDocument()
      expect(screen.queryByText('Tool: Bash')).not.toBeInTheDocument()

      // Tick 2: first tool call appears.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(container.querySelectorAll('.replay-tool-group')).toHaveLength(1)
      expect(container.querySelectorAll('.replay-disclosure--tool')).toHaveLength(1)
      expect(screen.getAllByText('Tool: Read')).toHaveLength(2)
      expect(screen.queryByText('Tool: Bash')).not.toBeInTheDocument()

      // Tick 3: second tool call appears and grouped label updates.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(container.querySelector('.replay-tool-group__label')?.textContent).toBe('2 tool calls')
      expect(container.querySelectorAll('.replay-disclosure--tool')).toHaveLength(2)
      expect(screen.getAllByText('Tool: Bash')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not enable transcript virtualization during playback', async () => {
    vi.useFakeTimers()

    const longSession: ReplaySession = {
      ...session,
      turnCount: 18,
      turns: Array.from({ length: 18 }, (_, index) => ({
        blocks: [{ id: `turn-${index}-block`, text: `Turn ${index + 1}`, type: 'text' }],
        id: `turn-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        summary: `Turn ${index + 1}`,
        timeLabel: '07:03 AM',
        timestamp: `2026-04-13T07:${String(index).padStart(2, '0')}:00.000Z`,
      })),
      updatedAt: '2026-04-13T07:17:00.000Z',
    }

    try {
      const longLayout = prepareTranscriptLayout(longSession.turns)
      const { container } = render(
        <PlaybackSurface
          session={longSession}
          layout={longLayout}
          onExitPlayback={vi.fn()}
        />,
      )

      for (let i = 0; i < 24; i++) {
        await act(async () => {
          await vi.runOnlyPendingTimersAsync()
        })
      }

      expect(container.querySelector('.preview-block__transcript')).not.toHaveClass(
        'preview-block__transcript--virtual',
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
