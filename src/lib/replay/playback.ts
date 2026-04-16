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

/**
 * Creates replay pacing units shared by the live preview and exported viewer.
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

/** Returns next timer delay, or `null` when playback should stop scheduling. */
export function getNextPlaybackDelay(
  turns: readonly ReplayPlaybackTurnPlan[],
  turnIndex: number,
  visibleUnitIds: ReadonlySet<string>,
  playbackSpeed: number,
): number | null {
  const currentTurn = turns[turnIndex]
  if (!currentTurn) {
    return null
  }

  const nextUnit = currentTurn.units.find((unit) => !visibleUnitIds.has(unit.id))
  if (nextUnit) {
    return Math.max(PLAYBACK_MIN_UNIT_DELAY_MS, Math.round(nextUnit.delayMs / playbackSpeed))
  }

  if (turnIndex < turns.length - 1) {
    return Math.max(120, Math.round(PLAYBACK_TURN_DWELL_MS / playbackSpeed))
  }

  return null
}

/** Reveals the next unit of the current turn or advances to the next turn; `null` means playback is complete. */
export function getNextPlaybackState(
  turns: readonly ReplayPlaybackTurnPlan[],
  turnIndex: number,
  visibleUnitIds: ReadonlySet<string>,
): { revealedUnitIds: Set<string>; turnIndex: number } | null {
  const currentTurn = turns[turnIndex]
  if (!currentTurn) {
    return null
  }

  const nextUnit = currentTurn.units.find((unit) => !visibleUnitIds.has(unit.id))
  if (nextUnit) {
    const nextVisibleUnitIds = new Set(visibleUnitIds)
    nextVisibleUnitIds.add(nextUnit.id)
    return {
      revealedUnitIds: nextVisibleUnitIds,
      turnIndex,
    }
  }

  // Advance to the next turn; its units are revealed on subsequent ticks.
  if (turnIndex < turns.length - 1) {
    return {
      revealedUnitIds: new Set(visibleUnitIds),
      turnIndex: turnIndex + 1,
    }
  }

  return null
}

/** Hides the most recent unit first, then moves back one turn; `null` means already at start. */
export function getPreviousPlaybackState(
  turns: readonly ReplayPlaybackTurnPlan[],
  turnIndex: number,
  visibleUnitIds: ReadonlySet<string>,
): { revealedUnitIds: Set<string>; turnIndex: number } | null {
  const currentTurn = turns[turnIndex]
  if (!currentTurn) {
    return null
  }

  for (let index = currentTurn.units.length - 1; index >= 0; index -= 1) {
    const unit = currentTurn.units[index]
    if (unit && visibleUnitIds.has(unit.id)) {
      const nextVisibleUnitIds = new Set(visibleUnitIds)
      nextVisibleUnitIds.delete(unit.id)
      return {
        revealedUnitIds: nextVisibleUnitIds,
        turnIndex,
      }
    }
  }

  if (turnIndex > 0) {
    return {
      revealedUnitIds: new Set(visibleUnitIds),
      turnIndex: turnIndex - 1,
    }
  }

  return null
}

/** Returns most recently revealed unit in active turn, not the next queued unit. */
export function getActivePlaybackUnitId(
  turn: ReplayPlaybackTurnPlan | undefined,
  visibleUnitIds: ReadonlySet<string>,
): string | null {
  if (!turn) {
    return null
  }

  for (let index = turn.units.length - 1; index >= 0; index -= 1) {
    const candidate = turn.units[index]
    if (candidate && visibleUnitIds.has(candidate.id)) {
      return candidate.id
    }
  }

  return null
}

function clampDelay(value: number): number {
  return Math.min(Math.max(value, 140), 900)
}
