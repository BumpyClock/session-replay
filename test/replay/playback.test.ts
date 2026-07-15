import { describe, expect, it } from 'vitest'
import type { ReplayPlaybackTurnPlan } from '../../src/lib/replay/playback'
import {
  createPlaybackTimeline,
  createReplayPlaybackTurns,
  getInitialPlaybackFrameIndex,
  getNextPlaybackFrameIndex,
  getPreviousPlaybackFrameIndex,
  getVisiblePlaybackUnitIds,
  isPlaybackTimelineComplete,
  PLAYBACK_TURN_DWELL_MS,
} from '../../src/lib/replay/playback'

describe('compact playback timeline', () => {
  it('represents forward, reverse, completion, and visibility with one frame cursor', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['a1', 'a2']),
      makeTurnPlan('t2', 'user'),
    ]
    const timeline = createPlaybackTimeline(turns)

    expect(timeline.frames).toHaveLength(5)
    expect(timeline.initialFrameIndexByTurn).toEqual([0, 1, 4])
    expect(getInitialPlaybackFrameIndex(timeline, -4)).toBe(0)
    expect(getInitialPlaybackFrameIndex(timeline, 99)).toBe(4)
    expect(getVisiblePlaybackUnitIds(turns, timeline.frames[1])).toEqual(new Set())
    expect(getVisiblePlaybackUnitIds(turns, timeline.frames[3])).toEqual(new Set(['a1', 'a2']))
    expect(timeline.frames[3]?.activeUnitId).toBe('a2')
    expect(getNextPlaybackFrameIndex(timeline, 3)).toBe(4)
    expect(getPreviousPlaybackFrameIndex(4)).toBe(3)
    expect(isPlaybackTimelineComplete(timeline, 4)).toBe(true)
  })

  it('precomputes existing speed floors and dwell delays', () => {
    const timeline = createPlaybackTimeline([
      makeTurnPlan('t0', 'assistant', ['a1']),
      makeTurnPlan('t1', 'user'),
    ])

    expect(timeline.frames[0]?.delayBySpeed).toEqual({ '1': 200, '2': 100, '4': 60, '8': 60 })
    expect(timeline.frames[1]?.delayBySpeed).toEqual({ '1': 420, '2': 210, '4': 120, '8': 120 })
    expect(timeline.frames.at(-1)?.delayBySpeed).toEqual({ '1': null, '2': null, '4': null, '8': null })
  })

  it('stays linear for empty and large plans without cumulative ID snapshots', () => {
    expect(createPlaybackTimeline([])).toEqual({ frames: [], initialFrameIndexByTurn: [] })

    const units = Array.from({ length: 10_000 }, (_, index) => `u${index}`)
    const turns = [makeTurnPlan('large', 'assistant', units)]
    const timeline = createPlaybackTimeline(turns)
    expect(timeline.frames.length).toBeLessThanOrEqual(units.length + turns.length)
    expect(timeline.frames.every((frame) => !('visibleUnitIds' in frame))).toBe(true)
  })
})

function makeTurnPlan(
  turnId: string,
  role: 'user' | 'assistant',
  unitIds: string[] = [],
): ReplayPlaybackTurnPlan {
  return {
    role,
    turnId,
    units: unitIds.map((id) => ({ delayMs: 200, id })),
  }
}

describe('timeline edge cases', () => {
  it('walks consecutive user and assistant turns forward and backward', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'user'),
      makeTurnPlan('t2', 'assistant', ['a1', 'a2']),
      makeTurnPlan('t3', 'assistant', ['a3']),
    ]
    const timeline = createPlaybackTimeline(turns)

    expect(timeline.frames.map((frame) => ({
      active: frame.activeUnitId,
      turn: frame.turnIndex,
      visible: [...getVisiblePlaybackUnitIds(turns, frame)],
    }))).toEqual([
      { active: null, turn: 0, visible: [] },
      { active: null, turn: 1, visible: [] },
      { active: null, turn: 2, visible: [] },
      { active: 'a1', turn: 2, visible: ['a1'] },
      { active: 'a2', turn: 2, visible: ['a1', 'a2'] },
      { active: null, turn: 3, visible: ['a1', 'a2'] },
      { active: 'a3', turn: 3, visible: ['a1', 'a2', 'a3'] },
    ])

    let cursor = 0
    while (getNextPlaybackFrameIndex(timeline, cursor) !== null) cursor += 1
    expect(cursor).toBe(timeline.frames.length - 1)
    while (getPreviousPlaybackFrameIndex(cursor) !== null) cursor -= 1
    expect(cursor).toBe(0)
  })

  it('handles zero-unit assistant turns and invalid cursors', () => {
    const timeline = createPlaybackTimeline([
      makeTurnPlan('empty-assistant', 'assistant'),
      makeTurnPlan('user', 'user'),
    ])

    expect(timeline.frames.map((frame) => frame.turnIndex)).toEqual([0, 1])
    expect(getNextPlaybackFrameIndex(timeline, 99)).toBeNull()
    expect(getPreviousPlaybackFrameIndex(-1)).toBeNull()
    expect(getVisiblePlaybackUnitIds([], undefined)).toEqual(new Set())
    expect(isPlaybackTimelineComplete({ frames: [], initialFrameIndexByTurn: [] }, 0)).toBe(false)
  })

  it('supports custom speeds while retaining unit and dwell floors', () => {
    const timeline = createPlaybackTimeline([
      makeTurnPlan('assistant', 'assistant', ['a1']),
      makeTurnPlan('user', 'user'),
    ], [1, 4, 100])

    expect(timeline.frames[0]?.delayBySpeed).toEqual({ '1': 200, '4': 60, '100': 60 })
    expect(timeline.frames[1]?.delayBySpeed).toEqual({
      '1': PLAYBACK_TURN_DWELL_MS,
      '4': 120,
      '100': 120,
    })
    expect(timeline.frames.at(-1)?.delayBySpeed).toEqual({ '1': null, '4': null, '100': null })
  })
})

describe('createReplayPlaybackTurns', () => {
  it('produces empty units for user turns and populated units for assistant turns', () => {
    const plans = createReplayPlaybackTurns([
      {
        blocks: [{ id: 'u1', text: 'Hello', type: 'text' }],
        id: 'turn-user',
        role: 'user',
      },
      {
        blocks: [{ id: 'a1', text: 'Reply', type: 'text' }],
        id: 'turn-assistant',
        role: 'assistant',
      },
    ])

    expect(plans).toHaveLength(2)
    expect(plans[0].units).toEqual([])
    expect(plans[0].role).toBe('user')
    expect(plans[1].units).toHaveLength(1)
    expect(plans[1].units[0].id).toBe('a1')
    expect(plans[1].role).toBe('assistant')
  })
})
