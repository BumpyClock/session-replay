import React, { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlaybackSurface } from '../../src/features/playback/PlaybackSurface'
import {
  deriveViewportState,
  usePlaybackViewport,
  type PlaybackViewportState,
  type UsePlaybackViewportResult,
} from '../../src/features/playback/usePlaybackViewport'
import type { ReplaySession } from '../../src/features/preview/ReplayPanel'
import { prepareTranscriptLayout } from '../../src/lib/replay/transcript-layout'

// ---------------------------------------------------------------------------
// deriveViewportState — pure state derivation
// ---------------------------------------------------------------------------
describe('deriveViewportState', () => {
  it('returns underflow-bottom-anchored when no overflow and not detached', () => {
    expect(deriveViewportState(false, false)).toBe('underflow-bottom-anchored')
  })

  it('returns overflow-scrollable when overflowing and not detached', () => {
    expect(deriveViewportState(true, false)).toBe('overflow-scrollable')
  })

  it('returns user-detached when user has manually scrolled regardless of overflow', () => {
    expect(deriveViewportState(true, true)).toBe('user-detached')
    expect(deriveViewportState(false, true)).toBe('user-detached')
  })

  it('user-detached takes priority over overflow', () => {
    const state = deriveViewportState(true, true)
    expect(state).toBe('user-detached')
  })

  it('expresses viewport state as explicit named strings, not boolean flags', () => {
    const validStates: PlaybackViewportState[] = [
      'underflow-bottom-anchored',
      'overflow-scrollable',
      'user-detached',
    ]
    expect(deriveViewportState(false, false)).toBe(validStates[0])
    expect(deriveViewportState(true, false)).toBe(validStates[1])
    expect(deriveViewportState(true, true)).toBe(validStates[2])
  })
})

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------
const session: ReplaySession = {
  cwd: '/repo',
  id: 'session-viewport',
  project: 'session-replay',
  provider: 'Codex',
  title: 'Viewport states',
  turnCount: 3,
  turns: [
    {
      blocks: [{ id: 'turn-0-block', text: 'First user turn', type: 'text' }],
      id: 'turn-0',
      role: 'user',
      summary: 'First user turn',
      timeLabel: '07:03 AM',
      timestamp: '2026-04-13T07:03:00.000Z',
    },
    {
      blocks: [
        { id: 'turn-1-block', text: '## Response\n\n- detail', type: 'markdown' },
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
      bookmarkLabel: 'Important result',
      isBookmarked: true,
      role: 'assistant',
      summary: '1 text, 1 tool call',
      timeLabel: '07:04 AM',
      timestamp: '2026-04-13T07:04:00.000Z',
    },
    {
      blocks: [{ id: 'turn-2-block', text: 'Follow-up question', type: 'text' }],
      id: 'turn-2',
      role: 'user',
      summary: 'Follow-up question',
      timeLabel: '07:05 AM',
      timestamp: '2026-04-13T07:05:00.000Z',
    },
  ],
  updatedAt: '2026-04-13T07:05:00.000Z',
}

const layout = prepareTranscriptLayout(session.turns)

function getStage(container: HTMLElement): HTMLElement {
  const stage = container.querySelector('.preview-block__stage')
  if (!stage) throw new Error('Stage element not found')
  return stage as HTMLElement
}

function getContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.preview-block__content--chat')
  if (!content) throw new Error('Content element not found')
  return content as HTMLElement
}

function ViewportHarness({
  onReady,
}: {
  onReady: (result: UsePlaybackViewportResult) => void
}) {
  const viewport = usePlaybackViewport()
  const { onContentScroll, setContentNode, viewportState } = viewport

  useEffect(() => {
    onReady(viewport)
  }, [onReady, viewport])

  return (
    <div
      ref={setContentNode}
      data-viewport-state={viewportState}
      onScroll={onContentScroll}
    />
  )
}

// ---------------------------------------------------------------------------
// PlaybackSurface viewport integration
// ---------------------------------------------------------------------------
describe('Playback viewport states', () => {
  it('does not detach on repeated programmatic scroll events before guard timeout', () => {
    vi.useFakeTimers()
    try {
      let viewport: UsePlaybackViewportResult | null = null
      const { container } = render(
        <ViewportHarness onReady={(result) => {
          viewport = result
        }}
        />,
      )

      const content = container.firstElementChild as HTMLDivElement
      Object.defineProperty(content, 'scrollTop', { configurable: true, value: 0, writable: true })
      Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 960 })
      Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 320 })

      act(() => {
        viewport?.checkOverflow()
      })
      expect(content).toHaveAttribute('data-viewport-state', 'overflow-scrollable')

      act(() => {
        viewport?.withProgrammaticScroll(() => {
          content.scrollTop = 100
        })
        fireEvent.scroll(content)
        fireEvent.scroll(content)
      })

      expect(content).toHaveAttribute('data-viewport-state', 'overflow-scrollable')

      act(() => {
        vi.advanceTimersByTime(151)
        fireEvent.scroll(content)
      })

      expect(content).toHaveAttribute('data-viewport-state', 'overflow-scrollable')

      act(() => {
        viewport?.markUserScrollIntent()
        fireEvent.scroll(content)
      })

      expect(content).toHaveAttribute('data-viewport-state', 'user-detached')
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders data-viewport-state attribute on the stage element', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <PlaybackSurface session={session} layout={layout} onExitPlayback={vi.fn()} />,
      )
      expect(getStage(container)).toHaveAttribute('data-viewport-state')
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts in underflow-bottom-anchored when content fits the viewport', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <PlaybackSurface session={session} layout={layout} onExitPlayback={vi.fn()} />,
      )
      // jsdom: scrollHeight=0, clientHeight=0 → no overflow → underflow
      expect(getStage(container)).toHaveAttribute('data-viewport-state', 'underflow-bottom-anchored')
    } finally {
      vi.useRealTimers()
    }
  })

  it('transitions to overflow-scrollable when content exceeds the viewport', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <PlaybackSurface session={session} layout={layout} onExitPlayback={vi.fn()} />,
      )

      const content = getContent(container)
      Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 960 })
      Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 320 })

      // Advance playback to trigger the overflow-check effect
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(getStage(container)).toHaveAttribute('data-viewport-state', 'overflow-scrollable')
    } finally {
      vi.useRealTimers()
    }
  })

  it('transitions to user-detached on manual scroll in overflow mode', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <PlaybackSurface session={session} layout={layout} onExitPlayback={vi.fn()} />,
      )

      const content = getContent(container)
      Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 960 })
      Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 320 })

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(getStage(container)).toHaveAttribute('data-viewport-state', 'overflow-scrollable')

      act(() => {
        fireEvent.wheel(content)
        fireEvent.scroll(content)
      })

      expect(getStage(container)).toHaveAttribute('data-viewport-state', 'user-detached')
    } finally {
      vi.useRealTimers()
    }
  })

  it('playback continues after user detaches without snapping back', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <PlaybackSurface session={session} layout={layout} onExitPlayback={vi.fn()} />,
      )

      const content = getContent(container)
      const scrollTo = vi.fn()
      content.scrollTo = scrollTo

      Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 960 })
      Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 320 })

      // Advance playback
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      const scrollCountBefore = scrollTo.mock.calls.length

      // Detach via manual scroll
      act(() => {
        fireEvent.wheel(content)
        fireEvent.scroll(content)
      })

      // Continue playback — advance multiple ticks
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      // scrollTo should NOT have been called since detach
      expect(scrollTo.mock.calls.length).toBe(scrollCountBefore)

      // Viewport remains detached
      expect(getStage(container)).toHaveAttribute('data-viewport-state', 'user-detached')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets viewport state when playback restarts after completion', async () => {
    vi.useFakeTimers()
    try {
      const { container } = render(
        <PlaybackSurface session={session} layout={layout} onExitPlayback={vi.fn()} />,
      )

      const content = getContent(container)
      Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 960 })
      Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 320 })

      // Advance and detach
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })
      act(() => {
        fireEvent.wheel(content)
        fireEvent.scroll(content)
      })

      expect(getStage(container)).toHaveAttribute('data-viewport-state', 'user-detached')

      // Run playback to completion
      for (let i = 0; i < 30; i++) {
        await act(async () => {
          await vi.runOnlyPendingTimersAsync()
        })
      }

      // Remove overflow to simulate fresh start
      Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 0 })
      Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 0 })

      // Click play to restart (resetPlayback fires on playbackComplete)
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Play transcript' }))
      })

      expect(getStage(container)).toHaveAttribute('data-viewport-state', 'underflow-bottom-anchored')
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves bookmark labels in playback viewport', async () => {
    vi.useFakeTimers()
    try {
      render(
        <PlaybackSurface session={session} layout={layout} onExitPlayback={vi.fn()} />,
      )

      // Advance to assistant turn which has a bookmark
      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      expect(screen.getByText('Important result')).toBeInTheDocument()
      expect(screen.getByLabelText('Bookmark note')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
