import type { ReplayRole, ReplayToolBlock, ReplayTurn } from '../api/contracts'
import { renderReplayBlockBodyHtml } from '../markdown/render'
import { classifyBlock } from '../text-layout/block-estimator'
import {
  getReplayBlockDefaultOpen,
  getReplayBlockLabel,
  getReplayBlockSummaryMeta,
  getReplayTurnPreviewText,
  getReplayTurnTone,
  summarizeReplayTurn,
} from './blocks'
import type { ReplayPlaybackTurnPlan } from './playback'
import { getReplaySegmentPlaybackUnits } from './playback'
import type { ReplayRenderableBlock } from './context-blocks'
import {
  createReplaySegments,
  getReplaySegmentDefaultOpen,
  getReplaySegmentDisclosureIds,
  getReplayToolRunLabel,
  getReplayToolRunSummaryMeta,
  shouldGroupReplayToolRun,
  type ReplaySegment,
} from './segments'
import type {
  PreparedBlockLayout,
  PreparedToolRunLayout,
  PreparedTurnLayout,
  PreparedTranscriptLayout,
} from './transcript-layout-types'

/** Minimal turn shape accepted by the layout builder. */
export type TranscriptLayoutTurnInput =
  Pick<ReplayTurn, 'blocks' | 'id'>
  & Partial<Pick<ReplayTurn, 'index' | 'label' | 'role'>>

/**
 * Build the shared transcript layout from raw turn data.
 *
 * Computes segments, pre-renders block HTML, and collects disclosure
 * metadata once so downstream consumers never repeat this work.
 */
export function prepareTranscriptLayout(
  turns: readonly TranscriptLayoutTurnInput[],
): PreparedTranscriptLayout {
  const prepared = turns.map(prepareTurnLayout)

  return {
    turns: prepared,
    turnLayoutById: new Map(prepared.map((t) => [t.turnId, t])),
  }
}

/**
 * Collect every default-open disclosure id across all turns.
 *
 * Useful for initializing the editor's expanded-block-ids state from the
 * layout without re-walking segments.
 */
export function collectDefaultOpenIds(layout: PreparedTranscriptLayout): Set<string> {
  const ids = new Set<string>()

  for (const turn of layout.turns) {
    for (const id of turn.defaultOpenIds) {
      ids.add(id)
    }
  }

  return ids
}

/**
 * Create playback turn plans from the prepared layout.
 *
 * Mirrors the semantics of {@link createReplayPlaybackTurns} in
 * `playback.ts` but derives units from pre-computed segments instead of
 * re-calling `createReplaySegments` per turn.
 */
export function createPlaybackTurnsFromLayout(
  turns: readonly { id: string; role: ReplayRole }[],
  layout: PreparedTranscriptLayout,
): ReplayPlaybackTurnPlan[] {
  return turns.map((turn) => {
    const turnLayout = layout.turnLayoutById.get(turn.id)

    return {
      role: turn.role,
      turnId: turn.id,
      units:
        turn.role === 'user' || !turnLayout
          ? []
          : turnLayout.playbackUnits.map((unit) => ({ ...unit })),
    }
  })
}

/**
 * Return only the tool-run blocks visible during playback.
 *
 * Operates on pre-computed segments so callers never rebuild from raw blocks.
 */
export function getVisibleToolRunBlocks(
  segment: Extract<ReplaySegment, { type: 'tool-run' }>,
  visibleUnitIds: ReadonlySet<string>,
): ReplayToolBlock[] {
  return segment.blocks.filter((block) => visibleUnitIds.has(block.id))
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function prepareTurnLayout(turn: TranscriptLayoutTurnInput): PreparedTurnLayout {
  const segments = createReplaySegments(turn.blocks)
  const blockHtml = new Map<string, string>()
  const blockMetaById = new Map<string, PreparedBlockLayout>()
  const disclosureIds: string[] = []
  const defaultOpenIds = new Set<string>()
  const toolRunMetaById = new Map<string, PreparedToolRunLayout>()
  const playbackUnits = segments.flatMap(getReplaySegmentPlaybackUnits)
  const renderableBlocks: ReplayRenderableBlock[] = []

  for (const segment of segments) {
    const ids = getReplaySegmentDisclosureIds(segment)
    disclosureIds.push(...ids)

    if (getReplaySegmentDefaultOpen(segment)) {
      for (const id of ids) {
        defaultOpenIds.add(id)
      }
    }

    if (segment.type === 'block') {
      renderableBlocks.push(segment.block)
      const blockLayout = prepareBlockLayout(segment.block)
      blockHtml.set(segment.block.id, blockLayout.bodyHtml)
      blockMetaById.set(segment.block.id, blockLayout)
    } else {
      toolRunMetaById.set(segment.id, {
        grouped: shouldGroupReplayToolRun(segment),
        label: getReplayToolRunLabel(segment),
        summaryMeta: getReplayToolRunSummaryMeta(segment),
      })
      for (const block of segment.blocks) {
        renderableBlocks.push(block)
        const blockLayout = prepareBlockLayout(block)
        blockHtml.set(block.id, blockLayout.bodyHtml)
        blockMetaById.set(block.id, blockLayout)
      }
    }
  }

  const normalizedTurn = {
    blocks: turn.blocks,
    id: turn.id,
    index: turn.index ?? 0,
    label: turn.label,
    role: turn.role ?? 'assistant',
  } satisfies Pick<ReplayTurn, 'blocks' | 'id' | 'index' | 'label' | 'role'>

  return {
    blockMetaById,
    turnId: turn.id,
    rowId: turn.id,
    segments,
    blockHtml,
    disclosureIds,
    defaultOpenIds,
    estimator: {
      disclosureCount: disclosureIds.length,
      playbackDurationMs: playbackUnits.reduce((sum, unit) => sum + unit.delayMs, 0),
      segmentCount: segments.length,
      unitCount: playbackUnits.length,
    },
    playbackUnits,
    previewText: getReplayTurnPreviewText(renderableBlocks),
    summary: summarizeReplayTurn(normalizedTurn),
    tone: getReplayTurnTone(normalizedTurn),
    toolRunMetaById,
  }
}

function prepareBlockLayout(block: ReplayRenderableBlock): PreparedBlockLayout {
  return {
    bodyHtml: renderReplayBlockBodyHtml(block),
    contentClassName: getPreparedBlockContentClassName(block),
    defaultOpen: getReplayBlockDefaultOpen(block),
    disclosureIds: isPreparedDisclosureBlock(block) ? [block.id] : [],
    isDisclosure: isPreparedDisclosureBlock(block),
    label: getReplayBlockLabel(block),
    summaryMeta: getReplayBlockSummaryMeta(block),
    estimatorMeta: classifyBlock(block),
  }
}

function isPreparedDisclosureBlock(block: ReplayRenderableBlock): boolean {
  return block.type === 'thinking' || block.type === 'tool' || (block.type === 'meta' && block.appearance === 'disclosure')
}

function getPreparedBlockContentClassName(block: ReplayRenderableBlock): string {
  if (block.type === 'tool') {
    return 'replay-disclosure__content replay-disclosure__content--tool'
  }

  if (block.type === 'meta') {
    return 'replay-disclosure__content replay-disclosure__content--meta'
  }

  return 'replay-disclosure__content'
}
