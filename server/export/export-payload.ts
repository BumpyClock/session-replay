import type { ReplayRenderOptions } from '../../src/lib/api/contracts'
import type { ReplayRenderableBlock } from '../../src/lib/replay/context-blocks'
import type { ReplayPlaybackTurnPlan } from '../../src/lib/replay/playback'
import type {
  PreparedBlockLayout,
  PreparedTurnLayout,
} from '../../src/lib/replay/transcript-layout-types'
import { estimateFallbackHeight } from '../../src/lib/text-layout/height-estimator'
import { LINE_HEIGHT_BODY_PX } from '../../src/lib/text-layout/typography'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Serializable payload embedded in the exported HTML document. */
export interface ExportPayload {
  turns: ExportTurnEntry[]
  playbackTurns: ReplayPlaybackTurnPlan[]
  initialTurnIndex: number
}

/** One turn's serialized data for client-side materialization. */
export interface ExportTurnEntry {
  /** Turn identifier matching the playback plan. */
  id: string
  /** Display index used by playback controls. */
  index: number
  /** Pre-rendered HTML for this turn row. */
  html: string
  /** Estimated pixel height for virtual list positioning. */
  estimatedHeight: number
}

// ---------------------------------------------------------------------------
// Height estimation constants
//
// Values match the CSS declarations in the export stylesheet so estimated
// heights approximate rendered output without DOM measurement.
// ---------------------------------------------------------------------------

/** Top + bottom padding inside a turn card. */
const TURN_CHROME_PX = 24
/** Header area: role label, summary, optional timestamp. */
const TURN_HEADER_PX = 40
/** Gap between segments within a turn body. */
const SEGMENT_GAP_PX = 12
/** Summary row height for disclosure blocks (collapsed). */
const DISCLOSURE_SUMMARY_PX = 32
/** Padding above disclosure content when expanded. */
const DISCLOSURE_CONTENT_PAD_PX = 12
/** Summary row height for grouped tool-run segments. */
const TOOL_GROUP_SUMMARY_PX = 36
/** Height of bookmark pill + bookmarked label. */
const BOOKMARK_CHROME_PX = 54
/** Gap between turns in the transcript list. */
export const TURN_GAP_PX = 12

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the serialized export payload from prepared layout data.
 *
 * Each turn carries its full pre-rendered HTML and an estimated pixel
 * height derived from the transcript-layout estimator metadata.
 */
export function buildExportPayload(
  turns: readonly { id: string; index: number }[],
  turnHtmlById: ReadonlyMap<string, string>,
  turnHeightById: ReadonlyMap<string, number>,
  playbackTurns: readonly ReplayPlaybackTurnPlan[],
  initialTurnIndex: number,
): ExportPayload {
  return {
    turns: turns.map((turn) => ({
      id: turn.id,
      index: turn.index,
      html: turnHtmlById.get(turn.id) ?? '',
      estimatedHeight: turnHeightById.get(turn.id) ?? 80,
    })),
    playbackTurns: playbackTurns.map((plan) => ({
      ...plan,
      units: [...plan.units],
    })),
    initialTurnIndex,
  }
}

/**
 * Estimate the rendered pixel height of a single turn row.
 *
 * Uses block-level estimator metadata from the prepared layout so the
 * export runtime never needs DOM measurement loops.
 */
export function estimateTurnHeight(
  turnLayout: PreparedTurnLayout,
  bookmarkLabel: string | undefined,
  options: ReplayRenderOptions,
): number {
  let height = TURN_CHROME_PX + TURN_HEADER_PX

  for (let i = 0; i < turnLayout.segments.length; i++) {
    if (i > 0) {
      height += SEGMENT_GAP_PX
    }

    const segment = turnLayout.segments[i]

    if (segment.type === 'block') {
      const blockMeta = turnLayout.blockMetaById.get(segment.block.id)
      height += estimateSegmentBlockHeight(blockMeta, segment.block, options)
    } else {
      const runMeta = turnLayout.toolRunMetaById.get(segment.id)
      if (runMeta?.grouped) {
        height += TOOL_GROUP_SUMMARY_PX
      } else {
        for (let j = 0; j < segment.blocks.length; j++) {
          if (j > 0) {
            height += SEGMENT_GAP_PX
          }
          const blockMeta = turnLayout.blockMetaById.get(segment.blocks[j].id)
          height += estimateDisclosureHeight(blockMeta)
        }
      }
    }
  }

  if (bookmarkLabel) {
    height += BOOKMARK_CHROME_PX
  }

  return Math.round(height)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function estimateSegmentBlockHeight(
  meta: PreparedBlockLayout | undefined,
  block: ReplayRenderableBlock,
  options: ReplayRenderOptions,
): number {
  if (!meta) {
    return 40
  }

  if (!meta.isDisclosure) {
    return estimateBlockContentHeight(meta)
  }

  const isOpen = isBlockExpanded(meta, block, options)
  if (!isOpen) {
    return DISCLOSURE_SUMMARY_PX
  }

  return DISCLOSURE_SUMMARY_PX + DISCLOSURE_CONTENT_PAD_PX + estimateBlockContentHeight(meta)
}

function estimateDisclosureHeight(meta: PreparedBlockLayout | undefined): number {
  if (!meta) {
    return DISCLOSURE_SUMMARY_PX
  }

  if (!meta.defaultOpen) {
    return DISCLOSURE_SUMMARY_PX
  }

  return DISCLOSURE_SUMMARY_PX + DISCLOSURE_CONTENT_PAD_PX + estimateBlockContentHeight(meta)
}

function estimateBlockContentHeight(meta: PreparedBlockLayout): number {
  const estimator = meta.estimatorMeta

  if (estimator.pretextEligible && estimator.measurableText) {
    const lines = Math.max(1, estimator.measurableText.split('\n').length)
    const lineHeight = estimator.lineHeightPx || LINE_HEIGHT_BODY_PX
    return Math.max(20, lines * lineHeight)
  }

  return Math.max(20, estimateFallbackHeight(estimator))
}

function isBlockExpanded(
  meta: PreparedBlockLayout,
  block: ReplayRenderableBlock,
  options: ReplayRenderOptions,
): boolean {
  if (block.type === 'thinking' && (options.revealThinking ?? false)) {
    return true
  }

  return meta.defaultOpen
}
