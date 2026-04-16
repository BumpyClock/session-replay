import { describe, expect, it } from 'vitest'
import type { ReplayPlaybackTurnPlan } from '../../src/lib/replay/playback'
import {
  createReplayPlaybackTurns,
  getActivePlaybackUnitId,
  getNextPlaybackDelay,
  getNextPlaybackState,
  getPreviousPlaybackState,
  PLAYBACK_TURN_DWELL_MS,
} from '../../src/lib/replay/playback'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getNextPlaybackState — paced forward progression
// ---------------------------------------------------------------------------

describe('getNextPlaybackState', () => {
  it('advances from a user turn to the next turn before revealing any assistant units', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['b1', 'b2', 'b3']),
    ]

    const result = getNextPlaybackState(turns, 0, new Set())

    expect(result).toEqual({
      turnIndex: 1,
      revealedUnitIds: new Set(),
    })
  })

  it('reveals one unrevealed unit of the current turn at a time', () => {
    const turns = [
      makeTurnPlan('t0', 'assistant', ['b1', 'b2', 'b3']),
    ]

    const result = getNextPlaybackState(turns, 0, new Set(['b1']))

    expect(result).toEqual({
      turnIndex: 0,
      revealedUnitIds: new Set(['b1', 'b2']),
    })
  })

  it('advances through consecutive user turns before revealing assistant units', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'user'),
      makeTurnPlan('t2', 'assistant', ['a1', 'a2']),
    ]

    // Step 1: from t0 → t1 (user, no units to reveal)
    const step1 = getNextPlaybackState(turns, 0, new Set())
    expect(step1).toEqual({ turnIndex: 1, revealedUnitIds: new Set() })

    // Step 2: from t1 → t2, assistant turn becomes active but still unrevealed
    const step2 = getNextPlaybackState(turns, step1!.turnIndex, step1!.revealedUnitIds)
    expect(step2).toEqual({ turnIndex: 2, revealedUnitIds: new Set() })

    // Step 3: first assistant unit appears
    const step3 = getNextPlaybackState(turns, step2!.turnIndex, step2!.revealedUnitIds)
    expect(step3).toEqual({ turnIndex: 2, revealedUnitIds: new Set(['a1']) })
  })

  it('returns null when all turns are exhausted', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['b1']),
    ]

    const result = getNextPlaybackState(turns, 1, new Set(['b1']))

    expect(result).toBeNull()
  })

  it('returns null for empty turn list', () => {
    expect(getNextPlaybackState([], 0, new Set())).toBeNull()
  })

  it('returns null for out-of-bounds turn index', () => {
    const turns = [makeTurnPlan('t0', 'user')]
    expect(getNextPlaybackState(turns, 5, new Set())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getPreviousPlaybackState — paced backward progression
// ---------------------------------------------------------------------------

describe('getPreviousPlaybackState', () => {
  it('removes the most recently revealed unit before leaving the current turn', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['b1', 'b2']),
    ]
    const revealed = new Set(['b1', 'b2'])

    const result = getPreviousPlaybackState(turns, 1, revealed)

    expect(result).toEqual({
      turnIndex: 1,
      revealedUnitIds: new Set(['b1']),
    })
  })

  it('steps back to the previous turn once the current turn has no revealed units', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['b1', 'b2']),
    ]

    const result = getPreviousPlaybackState(turns, 1, new Set())

    expect(result).toEqual({
      turnIndex: 0,
      revealedUnitIds: new Set(),
    })
  })

  it('returns null at turn 0 when user turn has no units', () => {
    const turns = [makeTurnPlan('t0', 'user')]
    expect(getPreviousPlaybackState(turns, 0, new Set())).toBeNull()
  })

  it('handles stepping back from turn 0 with revealed units (defensive)', () => {
    const turns = [makeTurnPlan('t0', 'assistant', ['b1'])]
    const result = getPreviousPlaybackState(turns, 0, new Set(['b1']))

    expect(result).toEqual({
      turnIndex: 0,
      revealedUnitIds: new Set(),
    })
  })

  it('preserves earlier turns revealed units when stepping back across turns', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['a1']),
      makeTurnPlan('t2', 'assistant', ['a2', 'a3']),
    ]
    const revealed = new Set(['a1', 'a2', 'a3'])

    const result = getPreviousPlaybackState(turns, 2, revealed)

    expect(result).toEqual({
      turnIndex: 2,
      revealedUnitIds: new Set(['a1', 'a2']),
    })
  })

  it('returns null for empty turn list', () => {
    expect(getPreviousPlaybackState([], 0, new Set())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getNextPlaybackDelay — paced timing
// ---------------------------------------------------------------------------

describe('getNextPlaybackDelay', () => {
  it('returns the next unit delay when current turn has unrevealed units', () => {
    const turns = [makeTurnPlan('t0', 'assistant', ['b1'])]
    const delay = getNextPlaybackDelay(turns, 0, new Set(), 1)

    expect(delay).toBe(200)
  })

  it('returns dwell delay when advancing to next turn', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['b1']),
    ]
    const delay = getNextPlaybackDelay(turns, 0, new Set(), 1)

    expect(delay).toBe(PLAYBACK_TURN_DWELL_MS)
  })

  it('scales dwell delay by playback speed', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['b1']),
    ]

    const delay4x = getNextPlaybackDelay(turns, 0, new Set(), 4)
    expect(delay4x).toBe(Math.max(120, Math.round(PLAYBACK_TURN_DWELL_MS / 4)))
  })

  it('scales unit delay by playback speed with a 60ms floor', () => {
    const turns = [makeTurnPlan('t0', 'assistant', ['b1'])]
    const delay4x = getNextPlaybackDelay(turns, 0, new Set(), 4)

    expect(delay4x).toBe(60)
  })

  it('returns null when all turns are exhausted', () => {
    const turns = [makeTurnPlan('t0', 'assistant', ['b1'])]
    const delay = getNextPlaybackDelay(turns, 0, new Set(['b1']), 1)

    expect(delay).toBeNull()
  })

  it('returns null for empty turn list', () => {
    expect(getNextPlaybackDelay([], 0, new Set(), 1)).toBeNull()
  })

  it('enforces minimum delay of 120ms', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['b1']),
    ]
    // Speed high enough that dwell / speed < 120
    const delay = getNextPlaybackDelay(turns, 0, new Set(), 100)

    expect(delay).toBe(120)
  })
})

// ---------------------------------------------------------------------------
// Full forward-backward round-trip
// ---------------------------------------------------------------------------

describe('paced round-trip', () => {
  it('walks forward through all turns then backward to start', () => {
    const turns = [
      makeTurnPlan('t0', 'user'),
      makeTurnPlan('t1', 'assistant', ['a1', 'a2']),
      makeTurnPlan('t2', 'user'),
      makeTurnPlan('t3', 'assistant', ['a3']),
    ]

    // Forward: t0 → t1
    let state = getNextPlaybackState(turns, 0, new Set())!
    expect(state.turnIndex).toBe(1)
    expect(state.revealedUnitIds).toEqual(new Set())

    // Forward: t1 reveal a1
    state = getNextPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(1)
    expect(state.revealedUnitIds).toEqual(new Set(['a1']))

    // Forward: t1 reveal a2
    state = getNextPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(1)
    expect(state.revealedUnitIds).toEqual(new Set(['a1', 'a2']))

    // Forward: t1 → t2 (user, no units)
    state = getNextPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(2)
    expect(state.revealedUnitIds).toEqual(new Set(['a1', 'a2']))

    // Forward: t2 → t3
    state = getNextPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(3)
    expect(state.revealedUnitIds).toEqual(new Set(['a1', 'a2']))

    // Forward: reveal a3
    state = getNextPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(3)
    expect(state.revealedUnitIds).toEqual(new Set(['a1', 'a2', 'a3']))

    // Forward: exhausted
    expect(getNextPlaybackState(turns, state.turnIndex, state.revealedUnitIds)).toBeNull()

    // Backward: remove a3
    state = getPreviousPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(3)
    expect(state.revealedUnitIds).toEqual(new Set(['a1', 'a2']))

    // Backward: t3 → t2
    state = getPreviousPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(2)
    expect(state.revealedUnitIds).toEqual(new Set(['a1', 'a2']))

    // Backward: t2 → t1 (user turn, no units to remove)
    state = getPreviousPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(1)
    expect(state.revealedUnitIds).toEqual(new Set(['a1', 'a2']))

    // Backward: remove a2
    state = getPreviousPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(1)
    expect(state.revealedUnitIds).toEqual(new Set(['a1']))

    // Backward: remove a1
    state = getPreviousPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(1)
    expect(state.revealedUnitIds).toEqual(new Set())

    // Backward: t1 → t0
    state = getPreviousPlaybackState(turns, state.turnIndex, state.revealedUnitIds)!
    expect(state.turnIndex).toBe(0)
    expect(state.revealedUnitIds).toEqual(new Set())

    // Backward: at start
    expect(getPreviousPlaybackState(turns, state.turnIndex, state.revealedUnitIds)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// createReplayPlaybackTurns — signature/contract preserved
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getActivePlaybackUnitId — unchanged contract
// ---------------------------------------------------------------------------

describe('getActivePlaybackUnitId', () => {
  it('returns last revealed unit in the turn', () => {
    const turn = makeTurnPlan('t0', 'assistant', ['b1', 'b2', 'b3'])
    const result = getActivePlaybackUnitId(turn, new Set(['b1', 'b2', 'b3']))

    expect(result).toBe('b3')
  })

  it('returns null when no units are revealed', () => {
    const turn = makeTurnPlan('t0', 'assistant', ['b1'])
    expect(getActivePlaybackUnitId(turn, new Set())).toBeNull()
  })

  it('returns null for undefined turn', () => {
    expect(getActivePlaybackUnitId(undefined, new Set())).toBeNull()
  })
})
