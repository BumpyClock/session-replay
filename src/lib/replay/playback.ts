import type { ReplayBlock, ReplayRole } from '../api/contracts'
import type { ReplayRenderableBlock } from './context-blocks'
import { createReplaySegments, type ReplaySegment } from './segments'

export const PLAYBACK_SPEEDS = [1, 2, 4, 8] as const
export const DEFAULT_PLAYBACK_SPEED = 4
const PLAYBACK_MIN_UNIT_DELAY_MS = 60

/**
 * Base pause between completed turns before advancing to next visible turn.
 * Consumers still divide this by the active playback speed.
 */
export const PLAYBACK_TURN_DWELL_MS = 420

/** One paced replay reveal step before speed scaling is applied. */
export type ReplayPlaybackUnit = {
  delayMs: number
  id: string
}

/**
 * Ordered playback plan for one visible turn.
 * User turns intentionally carry no units so they appear immediately.
 */
export type ReplayPlaybackTurnPlan = {
  role: ReplayRole
  turnId: string
  units: ReplayPlaybackUnit[]
}

export interface PlaybackFrame {
  turnIndex: number
  revealedUnitCount: number
  activeUnitId: string | null
  delayBySpeed: Readonly<Record<string, number | null>>
}

export interface PlaybackTimeline {
  frames: readonly PlaybackFrame[]
  initialFrameIndexByTurn: readonly number[]
}

/** Builds one compact frame per reachable turn/unit cursor position. */
export function createPlaybackTimeline(
  turns: readonly ReplayPlaybackTurnPlan[],
  speeds: readonly number[] = PLAYBACK_SPEEDS,
): PlaybackTimeline {
  const frames: PlaybackFrame[] = []
  const initialFrameIndexByTurn: number[] = []

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex]
    if (!turn) continue
    initialFrameIndexByTurn.push(frames.length)

    for (let revealedUnitCount = 0; revealedUnitCount <= turn.units.length; revealedUnitCount += 1) {
      const nextUnit = turn.units[revealedUnitCount]
      const hasNextTurn = turnIndex < turns.length - 1
      const delayBySpeed = Object.fromEntries(speeds.map((speed) => [
        String(speed),
        nextUnit
          ? Math.max(PLAYBACK_MIN_UNIT_DELAY_MS, Math.round(nextUnit.delayMs / speed))
          : hasNextTurn
            ? Math.max(120, Math.round(PLAYBACK_TURN_DWELL_MS / speed))
            : null,
      ]))

      frames.push({
        turnIndex,
        revealedUnitCount,
        activeUnitId: revealedUnitCount > 0 ? (turn.units[revealedUnitCount - 1]?.id ?? null) : null,
        delayBySpeed,
      })
    }
  }

  return { frames, initialFrameIndexByTurn }
}

export function getInitialPlaybackFrameIndex(
  timeline: PlaybackTimeline,
  initialTurnIndex: number,
): number {
  if (timeline.frames.length === 0) return 0
  const clampedTurnIndex = Math.min(Math.max(initialTurnIndex, 0), timeline.initialFrameIndexByTurn.length - 1)
  return timeline.initialFrameIndexByTurn[clampedTurnIndex] ?? 0
}

export function getPlaybackFrame(
  timeline: PlaybackTimeline,
  frameIndex: number,
): PlaybackFrame | undefined {
  return timeline.frames[frameIndex]
}

export function getNextPlaybackFrameIndex(timeline: PlaybackTimeline, frameIndex: number): number | null {
  return frameIndex < timeline.frames.length - 1 ? frameIndex + 1 : null
}

export function getPreviousPlaybackFrameIndex(frameIndex: number): number | null {
  return frameIndex > 0 ? frameIndex - 1 : null
}

export function isPlaybackTimelineComplete(timeline: PlaybackTimeline, frameIndex: number): boolean {
  return timeline.frames.length > 0 && frameIndex >= timeline.frames.length - 1
}

export function getVisiblePlaybackUnitIds(
  turns: readonly ReplayPlaybackTurnPlan[],
  frame: PlaybackFrame | undefined,
): Set<string> {
  const visibleUnitIds = new Set<string>()
  if (!frame) return visibleUnitIds

  for (let turnIndex = 0; turnIndex <= frame.turnIndex; turnIndex += 1) {
    const turn = turns[turnIndex]
    if (!turn) continue
    const visibleCount = turnIndex < frame.turnIndex ? turn.units.length : frame.revealedUnitCount
    for (let unitIndex = 0; unitIndex < visibleCount; unitIndex += 1) {
      const unitId = turn.units[unitIndex]?.id
      if (unitId) visibleUnitIds.add(unitId)
    }
  }

  return visibleUnitIds
}

/**
 * Creates replay pacing units shared by the playback surface and exported viewer.
 */
export function createReplayPlaybackTurns(
  turns: readonly Pick<{ blocks: readonly ReplayBlock[]; id: string; role: ReplayRole }, 'blocks' | 'id' | 'role'>[],
): ReplayPlaybackTurnPlan[] {
  return turns.map((turn) => ({
    role: turn.role,
    turnId: turn.id,
    // User turns stay instantaneous; only generated content replays in paced steps.
    units: turn.role === 'user' ? [] : createReplaySegments(turn.blocks).flatMap(getReplaySegmentPlaybackUnits),
  }))
}

/** Expands one replay segment into revealable playback units in source order. */
export function getReplaySegmentPlaybackUnits(segment: ReplaySegment): ReplayPlaybackUnit[] {
  if (segment.type === 'block') {
    return [
      {
        delayMs: estimateReplayBlockDelay(segment.block),
        id: segment.block.id,
      },
    ]
  }

  return segment.blocks.map((block) => ({
    delayMs: estimateReplayBlockDelay(block),
    id: block.id,
  }))
}

/** Estimates raw heuristic delay for one block before playback-speed scaling. */
export function estimateReplayBlockDelay(block: ReplayRenderableBlock): number {
  // Preview pacing is heuristic UX timing, not source-of-truth protocol timing.
  if (block.type === 'tool') {
    return clampDelay(280)
  }

  if (block.type === 'thinking') {
    return clampDelay(block.text.length * 8)
  }

  if (block.type === 'meta') {
    return clampDelay((block.body?.length ?? block.title.length) * 6)
  }

  return clampDelay(block.text.length * 10)
}

function clampDelay(value: number): number {
  return Math.min(Math.max(value, 140), 900)
}
