import React, { useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  computeAnchorCorrection,
  computeVisibleRange,
  DEFAULT_OVERSCAN,
  DEFAULT_ROW_HEIGHT,
  estimateTurnRowHeight,
  ROW_CHROME_HEIGHT,
  VIRTUALIZATION_THRESHOLD,
  useVirtualTranscript,
  type RowMeasurement,
  type VirtualTranscriptResult,
} from '../../src/features/preview/useVirtualTranscript'
import { prepareTranscriptLayout } from '../../src/lib/replay/transcript-layout'
import type { PreparedTurnLayout } from '../../src/lib/replay/transcript-layout-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(height: number, measured = false): RowMeasurement {
  return { height, measured }
}

function makeRows(heights: number[]): RowMeasurement[] {
  return heights.map((h) => row(h))
}

/** Create a minimal turn layout for a single text block. */
function makeTurnLayout(id: string, text: string): PreparedTurnLayout {
  const layout = prepareTranscriptLayout([
    { id, blocks: [{ id: `${id}-block`, type: 'text' as const, text }] },
  ])
  return layout.turns[0]
}

function VirtualTranscriptHarness({
  activeTurnIndex,
  onReady,
  preserveActiveTurnAnchor,
  turnLayouts,
}: {
  activeTurnIndex: number
  onReady: (result: VirtualTranscriptResult) => void
  preserveActiveTurnAnchor: boolean
  turnLayouts: readonly PreparedTurnLayout[]
}) {
  const virtualTranscript = useVirtualTranscript({
    turnLayouts,
    visibleTurnIds: null,
    activeTurnIndex,
    preserveActiveTurnAnchor,
    enabled: true,
  })

  useEffect(() => {
    onReady(virtualTranscript)
  }, [onReady, virtualTranscript])

  return React.createElement('div', { ref: virtualTranscript.containerRef })
}

// ---------------------------------------------------------------------------
// computeVisibleRange
// ---------------------------------------------------------------------------

describe('computeVisibleRange', () => {
  it('returns empty range for zero rows', () => {
    const result = computeVisibleRange([], 0, 500, DEFAULT_OVERSCAN)
    expect(result).toEqual({
      startIndex: 0,
      endIndex: -1,
      startOffset: 0,
      totalHeight: 0,
    })
  })

  it('returns all rows when they fit in the container', () => {
    const rows = makeRows([100, 100, 100])
    const result = computeVisibleRange(rows, 0, 500, DEFAULT_OVERSCAN)
    expect(result.startIndex).toBe(0)
    expect(result.endIndex).toBe(2)
    expect(result.totalHeight).toBe(300)
    expect(result.startOffset).toBe(0)
  })

  it('windows correctly when scrolled to the middle', () => {
    // 10 rows of 100px each = 1000px total, container = 300px
    const rows = makeRows(Array(10).fill(100))

    // scrollTop=300 means rows 3,4,5 are visible (300–600)
    const result = computeVisibleRange(rows, 300, 300, 0)
    expect(result.startIndex).toBe(3)
    expect(result.endIndex).toBe(5)
    expect(result.startOffset).toBe(300)
    expect(result.totalHeight).toBe(1000)
  })

  it('applies overscan correctly', () => {
    const rows = makeRows(Array(20).fill(100))

    // scrollTop=500 → rows 5–9 visible, overscan=3 → 2–12
    const result = computeVisibleRange(rows, 500, 500, 3)
    expect(result.startIndex).toBe(2)
    expect(result.endIndex).toBe(12)
    // startOffset = rows[0]+rows[1] = 200
    expect(result.startOffset).toBe(200)
  })

  it('clamps overscan at list boundaries', () => {
    const rows = makeRows(Array(5).fill(100))

    // scrollTop=0, container=200, overscan=10 → should clamp to 0..4
    const result = computeVisibleRange(rows, 0, 200, 10)
    expect(result.startIndex).toBe(0)
    expect(result.endIndex).toBe(4)
    expect(result.startOffset).toBe(0)
  })

  it('handles variable height rows', () => {
    const rows = makeRows([50, 200, 30, 100, 120])
    // total=500, scrollTop=100, container=200 → visible range covers 100..300
    // row 0: 0–50 (not visible)
    // row 1: 50–250 (visible - overlaps 100..300)
    // row 2: 250–280 (visible)
    // row 3: 280–380 (visible - overlaps)
    // row 4: 380–500 (not visible)
    const result = computeVisibleRange(rows, 100, 200, 0)
    expect(result.startIndex).toBe(1)
    expect(result.endIndex).toBe(3)
    expect(result.startOffset).toBe(50) // offset of row 1
  })

  it('handles scrolled past all content', () => {
    const rows = makeRows([100, 100])
    // scrollTop=500 is past the 200px total
    const result = computeVisibleRange(rows, 500, 300, 0)
    expect(result.startIndex).toBe(1)
    expect(result.endIndex).toBe(1)
    expect(result.totalHeight).toBe(200)
  })

  it('handles single row', () => {
    const rows = makeRows([100])
    const result = computeVisibleRange(rows, 0, 500, DEFAULT_OVERSCAN)
    expect(result.startIndex).toBe(0)
    expect(result.endIndex).toBe(0)
    expect(result.totalHeight).toBe(100)
    expect(result.startOffset).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// estimateTurnRowHeight
// ---------------------------------------------------------------------------

describe('estimateTurnRowHeight', () => {
  it('produces a height greater than chrome overhead for a text turn', () => {
    const layout = makeTurnLayout('t1', 'Hello world')
    const height = estimateTurnRowHeight(layout)
    expect(height).toBeGreaterThan(ROW_CHROME_HEIGHT)
  })

  it('produces larger estimates for longer content', () => {
    const shortLayout = makeTurnLayout('short', 'Hello')
    const longLayout = makeTurnLayout('long', 'Hello\n'.repeat(50))
    expect(estimateTurnRowHeight(longLayout)).toBeGreaterThan(estimateTurnRowHeight(shortLayout))
  })

  it('includes chrome overhead in the estimate', () => {
    const layout = makeTurnLayout('t1', 'One line')
    const height = estimateTurnRowHeight(layout)
    // Height should include at least the chrome
    expect(height).toBeGreaterThanOrEqual(ROW_CHROME_HEIGHT)
  })
})

// ---------------------------------------------------------------------------
// computeAnchorCorrection
// ---------------------------------------------------------------------------

describe('computeAnchorCorrection', () => {
  it('returns 0 when anchor is at index 0', () => {
    const old = makeRows([100, 100])
    const updated = makeRows([120, 100])
    expect(computeAnchorCorrection(0, old, updated)).toBe(0)
  })

  it('returns positive delta when rows before anchor grow', () => {
    const old = makeRows([100, 100, 100])
    const updated = makeRows([150, 100, 100])
    // Anchor at index 2: old offset = 200, new offset = 250
    expect(computeAnchorCorrection(2, old, updated)).toBe(50)
  })

  it('returns negative delta when rows before anchor shrink', () => {
    const old = makeRows([200, 100, 100])
    const updated = makeRows([100, 100, 100])
    expect(computeAnchorCorrection(2, old, updated)).toBe(-100)
  })

  it('returns 0 when no rows change before anchor', () => {
    const old = makeRows([100, 100, 100])
    const updated = makeRows([100, 100, 200])
    // Anchor at 2: only row 2 changed, rows before are same
    expect(computeAnchorCorrection(2, old, updated)).toBe(0)
  })

  it('handles multiple rows changing before anchor', () => {
    const old = makeRows([100, 100, 100, 100])
    const updated = makeRows([120, 80, 100, 100])
    // Anchor at 3: old offset = 300, new offset = 300 (net change 0)
    expect(computeAnchorCorrection(3, old, updated)).toBe(0)
  })
})

describe('useVirtualTranscript', () => {
  it('adjusts scroll position when the active row height changes', () => {
    const turnLayouts = [
      makeTurnLayout('turn-0', 'one'),
      makeTurnLayout('turn-1', 'two'),
      makeTurnLayout('turn-2', 'three'),
    ]

    let latestResult: VirtualTranscriptResult | null = null
    const { container } = render(React.createElement(VirtualTranscriptHarness, {
      activeTurnIndex: 1,
      onReady: (result: VirtualTranscriptResult) => {
        latestResult = result
      },
      preserveActiveTurnAnchor: true,
      turnLayouts,
    }))

    const scrollContainer = container.firstElementChild as HTMLDivElement
    Object.defineProperty(scrollContainer, 'scrollTop', { configurable: true, value: 120, writable: true })

    expect(latestResult).not.toBeNull()

    act(() => {
      const currentHeight = latestResult?.rowHeights[1]?.height ?? 0
      latestResult?.reportRowHeight(1, currentHeight + 50)
    })

    expect(scrollContainer.scrollTop).toBe(170)
  })

  it('does not adjust scroll position when active-turn anchoring is disabled', () => {
    const turnLayouts = [
      makeTurnLayout('turn-0', 'one'),
      makeTurnLayout('turn-1', 'two'),
      makeTurnLayout('turn-2', 'three'),
    ]

    let latestResult: VirtualTranscriptResult | null = null
    const { container } = render(React.createElement(VirtualTranscriptHarness, {
      activeTurnIndex: 2,
      onReady: (result: VirtualTranscriptResult) => {
        latestResult = result
      },
      preserveActiveTurnAnchor: false,
      turnLayouts,
    }))

    const scrollContainer = container.firstElementChild as HTMLDivElement
    Object.defineProperty(scrollContainer, 'scrollTop', { configurable: true, value: 120, writable: true })

    expect(latestResult).not.toBeNull()

    act(() => {
      const currentHeight = latestResult?.rowHeights[0]?.height ?? 0
      latestResult?.reportRowHeight(0, currentHeight + 50)
    })

    expect(scrollContainer.scrollTop).toBe(120)
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('virtualization constants', () => {
  it('DEFAULT_ROW_HEIGHT is a reasonable fallback', () => {
    expect(DEFAULT_ROW_HEIGHT).toBeGreaterThan(40)
    expect(DEFAULT_ROW_HEIGHT).toBeLessThan(200)
  })

  it('VIRTUALIZATION_THRESHOLD gates small transcripts', () => {
    expect(VIRTUALIZATION_THRESHOLD).toBeGreaterThanOrEqual(10)
  })

  it('DEFAULT_OVERSCAN is reasonable', () => {
    expect(DEFAULT_OVERSCAN).toBeGreaterThanOrEqual(1)
    expect(DEFAULT_OVERSCAN).toBeLessThanOrEqual(10)
  })
})
