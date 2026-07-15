import { describe, expect, it } from 'vitest'
import type { ReplayPlaybackTurnPlan } from '../../src/lib/replay/playback'
import { buildExportPayload } from '../../server/export/export-payload'

describe('buildExportPayload', () => {
  it('serializes only playback state', () => {
    const playbackTurns: ReplayPlaybackTurnPlan[] = [
      { turnId: 'turn-1', role: 'user', units: [{ id: 'unit-1', delayMs: 100 }] },
    ]

    const payload = buildExportPayload(playbackTurns, 2)
    expect(payload.playbackTurns).toEqual(playbackTurns)
    expect(payload.initialFrameIndex).toBe(0)
    expect(payload.playbackTimeline.frames).toHaveLength(2)
    expect(payload.speeds).toEqual([1, 2, 4, 8])
    expect(payload.viewport.programmaticScrollGuardMs).toBe(150)
  })

  it('copies each playback units array', () => {
    const units = [{ id: 'unit-1', delayMs: 50 }]
    const playbackTurns: ReplayPlaybackTurnPlan[] = [
      { turnId: 'turn-1', role: 'assistant', units },
    ]

    const result = buildExportPayload(playbackTurns, 0)

    expect(result.playbackTurns[0]?.units).toEqual(units)
    expect(result.playbackTurns[0]?.units).not.toBe(units)
  })

  it('does not serialize transcript content or layout heights', () => {
    const result = buildExportPayload([], 42)
    const serialized = JSON.stringify(result)

    expect(result.playbackTurns).toEqual([])
    expect(result.playbackTimeline).toEqual({ frames: [], initialFrameIndexByTurn: [] })
    expect(result.initialFrameIndex).toBe(0)
    expect(serialized).not.toContain('turns')
    expect(serialized).not.toContain('html')
    expect(serialized).not.toContain('estimatedHeight')
  })

  it('keeps frame and payload growth linear without cumulative ID arrays', () => {
    const units = Array.from({ length: 10_000 }, (_, index) => ({ id: `u${index}`, delayMs: 200 }))
    const payload = buildExportPayload([{ turnId: 'large', role: 'assistant', units }], 0)

    expect(payload.playbackTimeline.frames).toHaveLength(units.length + 1)
    expect(payload.playbackTimeline.frames.every((frame) => !('visibleUnitIds' in frame))).toBe(true)
  })
})
