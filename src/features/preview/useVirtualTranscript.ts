/**
 * Virtual transcript hook for windowed rendering of replay turn rows.
 *
 * Computes which turn rows are visible given a scroll container's
 * scrollTop + clientHeight, estimated row heights, and an overscan
 * count. Rows outside the visible window are unmounted.
 *
 * Height corrections: when a mounted row reports its actual DOM height
 * the hook stores the correction and adjusts total height. A balanced
 * anchor strategy keeps the active playback turn anchored during
 * corrections.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PreparedTurnLayout } from '../../lib/replay/transcript-layout-types'
import type { BlockEstimatorMeta } from '../../lib/text-layout/block-estimator-types'
import { createBlockHeightEstimator, estimateFallbackHeight } from '../../lib/text-layout/height-estimator'
import { createPretextCache } from '../../lib/text-layout/pretext-cache'
import {
  LINE_HEIGHT_BODY_PX,
} from '../../lib/text-layout/typography'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default estimated height for a turn row when no estimator data is available. */
export const DEFAULT_ROW_HEIGHT = 80

/** Extra vertical padding/margin per row for header/icon/controls chrome. */
export const ROW_CHROME_HEIGHT = 52

/** Gap between transcript rows. Included in each row slot height. */
export const ROW_GAP_PX = 12

/** Default overscan in both directions. */
export const DEFAULT_OVERSCAN = 3

/** Minimum transcript size to enable virtualization. */
export const VIRTUALIZATION_THRESHOLD = 15

/** Approximate horizontal chrome to subtract from container width for body text. */
const TURN_BODY_WIDTH_CHROME_PX = 96

// ---------------------------------------------------------------------------
// Pure visible-range math (exported for testing)
// ---------------------------------------------------------------------------

export interface RowMeasurement {
  /** Estimated or measured height of this row. */
  height: number
  /** Whether this is a DOM-measured value vs an estimate. */
  measured: boolean
}

export interface VisibleRange {
  /** First visible row index (inclusive, includes overscan). */
  startIndex: number
  /** Last visible row index (inclusive, includes overscan). */
  endIndex: number
  /** Pixel offset of the first visible row from the top of the list. */
  startOffset: number
  /** Total height of all rows. */
  totalHeight: number
}

/**
 * Compute visible range from scroll position, container height, and row heights.
 *
 * Pure function — no side effects.
 */
export function computeVisibleRange(
  rowHeights: readonly RowMeasurement[],
  scrollTop: number,
  containerHeight: number,
  overscan: number,
): VisibleRange {
  const rowCount = rowHeights.length

  if (rowCount === 0) {
    return { startIndex: 0, endIndex: -1, startOffset: 0, totalHeight: 0 }
  }

  // Walk rows once to find visible bounds and total height.
  let totalHeight = 0
  let firstVisibleIndex = rowCount // default past end
  let lastVisibleIndex = -1
  let runningTop = 0

  // Find first and last visible indices via linear scan.
  // For typical transcript sizes (< 500 turns) this is fast enough.
  for (let i = 0; i < rowCount; i++) {
    const h = rowHeights[i].height
    const rowTop = runningTop
    const rowBottom = runningTop + h

    if (rowBottom > scrollTop && rowTop < scrollTop + containerHeight) {
      if (i < firstVisibleIndex) firstVisibleIndex = i
      lastVisibleIndex = i
    }

    runningTop += h
  }
  totalHeight = runningTop

  // If nothing visible (scrolled past end), clamp to last row
  if (firstVisibleIndex >= rowCount) {
    firstVisibleIndex = Math.max(0, rowCount - 1)
    lastVisibleIndex = rowCount - 1
  }

  // Apply overscan
  const startIndex = Math.max(0, firstVisibleIndex - overscan)
  const endIndex = Math.min(rowCount - 1, lastVisibleIndex + overscan)

  // Compute offset of startIndex
  let startOffset = 0
  for (let i = 0; i < startIndex; i++) {
    startOffset += rowHeights[i].height
  }

  return { startIndex, endIndex, startOffset, totalHeight }
}

/**
 * Estimate the height of a single turn row from its prepared layout.
 *
 * Uses the block estimator metadata to sum block heights, then adds
 * chrome (header, icon, controls) overhead.
 */
export function estimateTurnRowHeight(
  turnLayout: PreparedTurnLayout,
  estimateHeight: (meta: BlockEstimatorMeta) => number = estimateBlockHeight,
): number {
  let contentHeight = 0

  for (const [, blockMeta] of turnLayout.blockMetaById) {
    contentHeight += estimateHeight(blockMeta.estimatorMeta)
  }

  // At minimum one line of body text
  contentHeight = Math.max(contentHeight, LINE_HEIGHT_BODY_PX)

  return contentHeight + ROW_CHROME_HEIGHT + ROW_GAP_PX
}

/**
 * Estimate a single block's height using the best available heuristic.
 *
 * For pretext-eligible blocks we count newlines in the measurable text
 * since the Pretext cache isn't available server-side / in tests.
 * For non-eligible blocks we delegate to the fallback estimator.
 */
function estimateBlockHeight(meta: BlockEstimatorMeta): number {
  if (meta.pretextEligible && meta.measurableText !== null && meta.lineHeightPx !== null) {
    const lineCount = Math.max(1, meta.measurableText.split('\n').length)
    return lineCount * meta.lineHeightPx
  }

  return estimateFallbackHeight(meta)
}

/**
 * Compute the scroll offset needed to keep a specific row anchored
 * after row heights change.
 *
 * Returns the delta to add to scrollTop, or 0 if no correction is needed.
 */
export function computeAnchorCorrection(
  anchorIndex: number,
  oldHeights: readonly RowMeasurement[],
  newHeights: readonly RowMeasurement[],
): number {
  if (anchorIndex <= 0) return 0

  let oldOffset = 0
  let newOffset = 0

  for (let i = 0; i < anchorIndex; i++) {
    oldOffset += (oldHeights[i]?.height ?? 0)
    newOffset += (newHeights[i]?.height ?? 0)
  }

  return newOffset - oldOffset
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface VirtualTranscriptOptions {
  /** Turn layouts in display order. */
  turnLayouts: readonly PreparedTurnLayout[]
  /** Set of turn ids that should be rendered. Null = show all. */
  visibleTurnIds: ReadonlySet<string> | null
  /** Index of the currently-active playback turn (for anchoring). -1 = none. */
  activeTurnIndex: number
  /** Overscan row count in each direction. */
  overscan?: number
  /** Whether virtualization is enabled. */
  enabled: boolean
}

export interface VirtualTranscriptResult {
  /** Range of rows to render. */
  visibleRange: VisibleRange
  /** Total list height in px for the scroll container sentinel. */
  totalHeight: number
  /** Row heights array (current best estimate or measured). */
  rowHeights: readonly RowMeasurement[]
  /** Callback to attach to the scroll container ref. */
  containerRef: (node: HTMLDivElement | null) => void
  /** Report a measured row height from the DOM. */
  reportRowHeight: (index: number, height: number) => void
  /** Force recalculation (e.g., after disclosure toggle). */
  invalidate: () => void
}

export function useVirtualTranscript({
  turnLayouts,
  visibleTurnIds,
  activeTurnIndex,
  overscan = DEFAULT_OVERSCAN,
  enabled,
}: VirtualTranscriptOptions): VirtualTranscriptResult {
  // Filter to visible turns
  const visibleLayouts = useMemo(() => {
    if (!visibleTurnIds) return turnLayouts
    return turnLayouts.filter((tl) => visibleTurnIds.has(tl.turnId))
  }, [turnLayouts, visibleTurnIds])

  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [fontEpoch, setFontEpoch] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number>(0)
  const [estimator] = useState(() => createBlockHeightEstimator(createPretextCache()))

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document) || !document.fonts?.ready) {
      return
    }

    let cancelled = false
    document.fonts.ready.then(() => {
      if (cancelled) {
        return
      }

      estimator.invalidateTextLayout()
      setFontEpoch((current) => current + 1)
    }).catch(() => {
      // Font APIs are best-effort only; fallback estimates still work.
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Sync estimated heights when layouts change
  const estimatedHeights = useMemo<RowMeasurement[]>(
    () => {
      const maxWidth = Math.max(0, containerWidth - TURN_BODY_WIDTH_CHROME_PX)
      const estimateBlockWithWidth = (meta: BlockEstimatorMeta) => {
        if (maxWidth <= 0) {
          return estimateBlockHeight(meta)
        }

        return estimator.estimateBlockHeight(meta, maxWidth)
      }

      return visibleLayouts.map((tl) => ({
        height: estimateTurnRowHeight(tl, estimateBlockWithWidth),
        measured: false,
      }))
    },
    [visibleLayouts, containerWidth, estimator, fontEpoch],
  )

  const [rowHeights, setRowHeights] = useState<RowMeasurement[]>(() => estimatedHeights)

  useEffect(() => {
    setRowHeights(estimatedHeights)
  }, [estimatedHeights])

  const visibleRange = useMemo(
    () => {
      if (!enabled) {
        // No virtualization — show all
        const totalHeight = rowHeights.reduce((sum, r) => sum + r.height, 0)
        return {
          startIndex: 0,
          endIndex: Math.max(0, rowHeights.length - 1),
          startOffset: 0,
          totalHeight,
        }
      }
      return computeVisibleRange(rowHeights, scrollTop, containerHeight, overscan)
    },
    [rowHeights, scrollTop, containerHeight, overscan, enabled],
  )

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setScrollTop(el.scrollTop)
      setContainerHeight(el.clientHeight)
      setContainerWidth(el.clientWidth)
    })
  }, [])

  const setContainerRefCallback = useCallback((node: HTMLDivElement | null) => {
    const prev = containerRef.current
    if (prev) {
      prev.removeEventListener('scroll', handleScroll)
    }
    containerRef.current = node
    if (node) {
      node.addEventListener('scroll', handleScroll, { passive: true })
      setScrollTop(node.scrollTop)
      setContainerHeight(node.clientHeight)
      setContainerWidth(node.clientWidth)
    }
  }, [handleScroll])

  // Observe container resize
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      setContainerHeight(el.clientHeight)
      setContainerWidth(el.clientWidth)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setContainerRefCallback])

  const reportRowHeight = useCallback((index: number, height: number) => {
    setRowHeights((prev) => {
      const existing = prev[index]
      if (!existing || Math.abs(existing.height - height) < 2) {
        return prev // Skip trivial corrections
      }

      const next = [...prev]
      next[index] = { height, measured: true }

      // Anchor correction: if the changed row is above the active turn,
      // adjust scrollTop to keep the active turn in place.
      if (activeTurnIndex >= 0 && index < activeTurnIndex && containerRef.current) {
        const delta = computeAnchorCorrection(activeTurnIndex, prev, next)
        if (Math.abs(delta) > 1) {
          containerRef.current.scrollTop += delta
        }
      }

      return next
    })
  }, [activeTurnIndex])

  const invalidate = useCallback(() => {
    setRowHeights(estimatedHeights)
  }, [estimatedHeights])

  // Cleanup
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return {
    visibleRange,
    totalHeight: visibleRange.totalHeight,
    rowHeights,
    containerRef: setContainerRefCallback,
    reportRowHeight,
    invalidate,
  }
}
