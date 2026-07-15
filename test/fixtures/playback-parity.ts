import type { MaterializedReplaySession } from '../../src/lib/api/contracts'
import type { ReplaySession } from '../../src/features/preview/ReplayPanel'

const cursorTrace = [
  { activeUnitId: null, previousDisabled: true, visibleTurnIds: ['parity-user'], visibleUnitIds: [] },
  { activeUnitId: null, previousDisabled: false, visibleTurnIds: ['parity-user', 'parity-assistant'], visibleUnitIds: [] },
  { activeUnitId: 'parity-a1', previousDisabled: false, visibleTurnIds: ['parity-user', 'parity-assistant'], visibleUnitIds: ['parity-a1'] },
  { activeUnitId: 'parity-a2', previousDisabled: false, visibleTurnIds: ['parity-user', 'parity-assistant'], visibleUnitIds: ['parity-a1', 'parity-a2'] },
  { activeUnitId: 'parity-a1', previousDisabled: false, visibleTurnIds: ['parity-user', 'parity-assistant'], visibleUnitIds: ['parity-a1'] },
  { activeUnitId: 'parity-a2', previousDisabled: false, visibleTurnIds: ['parity-user', 'parity-assistant'], visibleUnitIds: ['parity-a1', 'parity-a2'] },
  { activeUnitId: null, previousDisabled: false, visibleTurnIds: ['parity-user', 'parity-assistant', 'parity-final'], visibleUnitIds: ['parity-a1', 'parity-a2'] },
  { activeUnitId: null, previousDisabled: true, visibleTurnIds: ['parity-user'], visibleUnitIds: [] },
] as const

export const PLAYBACK_PARITY_TRACE = cursorTrace.map((entry) => ({
  ...entry,
  mode: 'paused',
  nextDisabled: false,
  viewportState: 'underflow-bottom-anchored',
}))

const turns = [
  {
    blocks: [{ id: 'parity-user-block', text: 'Start parity playback.', type: 'text' as const }],
    id: 'parity-user',
    role: 'user' as const,
  },
  {
    blocks: [
      { id: 'parity-a1', text: 'First answer.', type: 'markdown' as const },
      { id: 'parity-a2', text: 'Second answer.', type: 'markdown' as const },
    ],
    id: 'parity-assistant',
    role: 'assistant' as const,
  },
  {
    blocks: [{ id: 'parity-final-block', text: 'Final question.', type: 'text' as const }],
    id: 'parity-final',
    role: 'user' as const,
  },
]

export function createParityPreviewSession(): ReplaySession {
  return {
    cwd: '/repo',
    id: 'parity-session',
    project: 'session-replay',
    provider: 'Codex',
    title: 'Playback parity',
    turnCount: turns.length,
    turns: turns.map((turn, index) => ({
      ...turn,
      summary: `Parity turn ${index + 1}`,
      timeLabel: '08:00 AM',
      timestamp: `2026-04-13T08:00:0${index + 1}.000Z`,
    })),
    updatedAt: '2026-04-13T08:01:00.000Z',
  }
}

export function createParityMaterializedSession(): MaterializedReplaySession {
  return {
    bookmarks: [],
    id: 'parity-session',
    source: 'codex',
    startedAt: '2026-04-13T08:00:00.000Z',
    title: 'Playback parity',
    turns: turns.map((turn, index) => ({
      ...turn,
      index,
      timestamp: `2026-04-13T08:00:0${index + 1}.000Z`,
    })),
    updatedAt: '2026-04-13T08:01:00.000Z',
  }
}
