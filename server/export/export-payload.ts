import {
  createPlaybackTimeline,
  getInitialPlaybackFrameIndex,
  PLAYBACK_SPEEDS,
  type PlaybackTimeline,
  type ReplayPlaybackTurnPlan,
} from '../../src/lib/replay/playback'
import { PLAYBACK_VIEWPORT_MANIFEST } from '../../src/lib/replay/playback-viewport'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Serializable payload embedded in the exported HTML document. */
export interface ExportPayload {
  playbackTurns: ReplayPlaybackTurnPlan[]
  playbackTimeline: PlaybackTimeline
  initialFrameIndex: number
  speeds: readonly number[]
  viewport: typeof PLAYBACK_VIEWPORT_MANIFEST
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the serialized playback state embedded beside the server-rendered transcript.
 */
export function buildExportPayload(
  playbackTurns: readonly ReplayPlaybackTurnPlan[],
  initialTurnIndex: number,
): ExportPayload {
  const playbackTimeline = createPlaybackTimeline(playbackTurns)
  return {
    playbackTurns: playbackTurns.map((plan) => ({
      ...plan,
      units: [...plan.units],
    })),
    playbackTimeline,
    initialFrameIndex: getInitialPlaybackFrameIndex(playbackTimeline, initialTurnIndex),
    speeds: PLAYBACK_SPEEDS,
    viewport: PLAYBACK_VIEWPORT_MANIFEST,
  }
}
