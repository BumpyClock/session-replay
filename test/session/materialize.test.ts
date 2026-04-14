import type { NormalizedSession } from '../../src/lib/session/contracts'
import {
  createSessionStats,
  sessionMatchesQuery,
  summarizeNormalizedSession,
  toApiSessionRef,
  toMaterializedReplaySession,
} from '../../src/lib/session/materialize'

function createFixtureSession(): NormalizedSession {
  return {
    ref: {
      id: 'codex:session-1',
      path: '/tmp/session-1.jsonl',
      source: 'codex',
      project: 'demo-project',
      title: 'Inspect src/app.ts',
      startedAt: '2026-04-12T10:00:00Z',
      updatedAt: '2026-04-12T10:00:03Z',
      cwd: '/tmp/demo-project',
    },
    cwd: '/tmp/demo-project',
    warnings: [],
    turns: [
      {
        id: 'turn-1',
        index: 0,
        role: 'turn',
        timestamp: '2026-04-12T10:00:00Z',
        userText: 'Inspect src/app.ts',
        assistantBlocks: [
          {
            id: 'turn-1-thinking',
            kind: 'thinking',
            text: 'Need read file first.',
            timestamp: '2026-04-12T10:00:01Z',
            sourceMeta: {
              provider: 'codex',
              filePath: '/tmp/session-1.jsonl',
            },
          },
          {
            id: 'tool-1',
            kind: 'tool-call',
            name: 'Read',
            input: { file_path: '/tmp/demo-project/src/app.ts' },
            result: 'hello wrld',
            isError: false,
            timestamp: '2026-04-12T10:00:01Z',
            resultTimestamp: '2026-04-12T10:00:01Z',
            sourceMeta: {
              provider: 'codex',
              filePath: '/tmp/session-1.jsonl',
            },
          },
          {
            id: 'turn-1-answer',
            kind: 'text',
            text: 'Found typo in greeting.',
            timestamp: '2026-04-12T10:00:02Z',
            sourceMeta: {
              provider: 'codex',
              filePath: '/tmp/session-1.jsonl',
            },
          },
        ],
        sourceMeta: {
          provider: 'codex',
          filePath: '/tmp/session-1.jsonl',
        },
      },
    ],
  }
}

describe('session materialization', () => {
  it('converts normalized sessions into alternating replay turns', () => {
    const session = createFixtureSession()

    const replay = toMaterializedReplaySession(session)

    expect(replay.turns).toHaveLength(2)
    expect(replay.turns[0]?.role).toBe('user')
    expect(replay.turns[1]?.role).toBe('assistant')
    expect(replay.turns[1]?.blocks.map((block) => block.type)).toEqual([
      'thinking',
      'tool',
      'markdown',
    ])
    expect(replay.turns[1]?.blocks[1]).toMatchObject({
      input: expect.stringContaining('file_path'),
      name: 'Read',
      type: 'tool',
    })
  })

  it('computes list metadata and content search from normalized sessions', () => {
    const session = createFixtureSession()

    expect(summarizeNormalizedSession(session)).toBe('Inspect src/app.ts')
    expect(createSessionStats(session)).toEqual({
      turnCount: 2,
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolCallCount: 1,
    })
    expect(toApiSessionRef(session.ref, session).summary).toBe('Inspect src/app.ts')
    expect(sessionMatchesQuery(session, 'hello wrld')).toBe(true)
    expect(sessionMatchesQuery(session, 'missing phrase')).toBe(false)
  })
})
