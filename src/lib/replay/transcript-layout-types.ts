import type { BlockEstimatorMeta } from '../text-layout/block-estimator-types'
import type { ReplayTurnTone } from './blocks'
import type { ReplayPlaybackUnit } from './playback'
import type { ReplaySegment } from './segments'

/** Render-ready metadata for one replay block, whether inline or disclosure-backed. */
export interface PreparedBlockLayout {
  bodyHtml: string
  contentClassName: string
  defaultOpen: boolean
  disclosureIds: readonly string[]
  isDisclosure: boolean
  label: string
  summaryMeta: string | null
  /** Per-block estimator metadata for virtualized height estimation. */
  estimatorMeta: BlockEstimatorMeta
}

/** Precomputed presentation metadata for one tool-run segment. */
export interface PreparedToolRunLayout {
  grouped: boolean
  label: string
  summaryMeta: string | null
}

/** Heuristic sizing metadata reserved for future transcript virtualization. */
export interface PreparedTurnEstimator {
  disclosureCount: number
  playbackDurationMs: number
  segmentCount: number
  unitCount: number
}

/**
 * Precomputed layout data for a single replay turn.
 *
 * Segments, rendered HTML, and disclosure metadata are prepared once so
 * neither the editor transcript nor the export renderer recomputes them
 * during their render loops.
 */
export interface PreparedTurnLayout {
  /** Matches the source turn's id. */
  turnId: string
  /** Stable row id reserved for transcript virtualization. */
  rowId: string
  /** Segments computed once from the turn's raw blocks. */
  segments: readonly ReplaySegment[]
  /** Pre-rendered body HTML keyed by renderable block id. */
  blockHtml: ReadonlyMap<string, string>
  /** Prepared render metadata keyed by block id. */
  blockMetaById: ReadonlyMap<string, PreparedBlockLayout>
  /** All disclosure ids across every segment in this turn. */
  disclosureIds: readonly string[]
  /** Subset of {@link disclosureIds} that should be expanded by default. */
  defaultOpenIds: ReadonlySet<string>
  /** Stable turn summary reused by editor and export consumers. */
  summary: string
  /** Stable hidden-turn preview reused by editor and export consumers. */
  previewText: string
  /** Stable tone metadata reused by editor and export consumers. */
  tone: ReplayTurnTone
  /** Pre-expanded playback units so consumers never rebuild them from segments. */
  playbackUnits: readonly ReplayPlaybackUnit[]
  /** Heuristic sizing metadata reserved for future transcript virtualization. */
  estimator: PreparedTurnEstimator
  /** Prepared group metadata keyed by tool-run segment id. */
  toolRunMetaById: ReadonlyMap<string, PreparedToolRunLayout>
}

/**
 * Precomputed transcript layout for an entire replay session.
 *
 * Built once after session materialization, then consumed by both the
 * editor playback panel and the export HTML renderer.
 */
export interface PreparedTranscriptLayout {
  /** Prepared layouts in source turn order. */
  turns: readonly PreparedTurnLayout[]
  /** O(1) lookup from turn id to its prepared layout. */
  turnLayoutById: ReadonlyMap<string, PreparedTurnLayout>
}
