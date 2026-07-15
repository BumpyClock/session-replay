import { createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { MaterializedReplaySession, ReplayBlock } from '../../src/lib/api/contracts'
import {
  createEditorStore,
  createEmptySessionDraft,
  materializeReplayRenderRequest,
  materializeReplayRenderOptions,
  materializeReplaySession,
  type PersistedEditorStoreState,
} from '../../src/lib/editor'

function getTextBlock(block: ReplayBlock | undefined): Exclude<ReplayBlock, { type: 'tool' }> {
  if (!block || block.type === 'tool') {
    throw new Error('Expected replay text block')
  }

  return block
}

function createMemoryStorage(): StateStorage {
  const state = new Map<string, string>()

  return {
    getItem: (name) => state.get(name) ?? null,
    removeItem: (name) => {
      state.delete(name)
    },
    setItem: (name, value) => {
      state.set(name, value)
    },
  }
}

function createFixtureSession(): MaterializedReplaySession {
  return {
    cwd: '/tmp/session-replay',
    description: 'Original summary',
    id: 'session-1',
    project: 'session-replay',
    source: 'codex',
    startedAt: '2026-04-12T08:00:00Z',
    summary: 'Replay fixture',
    title: 'Original title',
    turns: [
      {
        blocks: [
          {
            id: 'turn-1-user',
            text: 'First user turn',
            type: 'text',
          },
        ],
        id: 'turn-1',
        included: true,
        index: 0,
        role: 'user',
        timestamp: '2026-04-12T08:00:01Z',
      },
      {
        blocks: [
          {
            id: 'turn-2-assistant',
            text: 'Draft me later',
            type: 'markdown',
          },
          {
            id: 'turn-2-thinking',
            text: 'Hidden chain',
            type: 'thinking',
          },
          {
            id: 'tool-1',
            input: '{"cmd":"ls"}',
            name: 'exec_command',
            output: 'ok',
            status: 'completed',
            type: 'tool',
          },
        ],
        id: 'turn-2',
        included: true,
        index: 1,
        role: 'assistant',
        timestamp: '2026-04-12T08:00:02Z',
      },
      {
        blocks: [
          {
            id: 'turn-3-user',
            text: 'Last turn',
            type: 'text',
          },
        ],
        id: 'turn-3',
        included: true,
        index: 2,
        role: 'user',
        timestamp: '2026-04-12T08:00:03Z',
      },
    ],
    updatedAt: '2026-04-12T08:05:00Z',
  }
}

describe('editor draft store', () => {
  it('persists client-only draft state keyed by session id', async () => {
    const storage = createJSONStorage<PersistedEditorStoreState>(() => createMemoryStorage())
    const store = createEditorStore({
      persistKey: 'editor-draft-test',
      storage,
    })

    store.getState().setBlockText(
      'session-1',
      'revision-1',
      'turn-2',
      'turn-2-assistant',
      'Edited assistant text',
    )
    store.getState().setTurnIncluded('session-1', 'revision-1', 'turn-2', false)
    store.getState().setBookmark('session-1', 'revision-1', 'turn-3', 'Ship it')
    store.getState().setExportMeta('session-1', 'revision-1', {
      description: 'Edited description',
      fileName: 'session-replay',
      title: 'Edited title',
    })
    store.getState().setViewerOptions('session-1', 'revision-1', {
      includeThinking: true,
      initialTurnId: 'turn-3',
      revealThinking: true,
    })

    const rehydratedStore = createEditorStore({
      persistKey: 'editor-draft-test',
      storage,
    })
    await rehydratedStore.persist.rehydrate()

    expect(rehydratedStore.getState().drafts['session-1']).toEqual({
      baseRevision: 'revision-1',
      blockTextEdits: {
        'turn-2': {
          'turn-2-assistant': 'Edited assistant text',
        },
      },
      bookmarks: {
        'turn-3': {
          label: 'Ship it',
        },
      },
      excludedTurnIds: ['turn-2'],
      exportMeta: {
        description: 'Edited description',
        fileName: 'session-replay',
        title: 'Edited title',
      },
      sessionId: 'session-1',
      viewerOptions: {
        autoplayDelayMs: undefined,
        includeThinking: true,
        includeTimestamps: true,
        includeToolCalls: true,
        initialTurnId: 'turn-3',
        revealThinking: true,
      },
    })
  })

  it('invalidates stale drafts when base revision changes', () => {
    const store = createEditorStore({
      persistKey: 'editor-draft-revision-test',
      storage: createJSONStorage(() => createMemoryStorage()),
    })

    store.getState().setBlockText(
      'session-1',
      'revision-1',
      'turn-2',
      'turn-2-assistant',
      'Edited assistant text',
    )

    const refreshedDraft = store.getState().ensureDraft('session-1', 'revision-2')

    expect(refreshedDraft).toEqual(createEmptySessionDraft({
      baseRevision: 'revision-2',
      sessionId: 'session-1',
    }))
    expect(store.getState().drafts['session-1']).toEqual(refreshedDraft)
  })
})

describe('editor materialization', () => {
  it('merges readonly session data with client-side edits without mutating tool payloads', () => {
    const session = createFixtureSession()
    const draft = {
      ...createEmptySessionDraft({
        baseRevision: 'revision-1',
        sessionId: session.id,
      }),
      blockTextEdits: {
        'turn-2': {
          'turn-2-assistant': 'Edited assistant text',
        },
      },
      bookmarks: {
        'turn-3': {
          label: 'Final answer',
        },
      },
      excludedTurnIds: ['turn-2'],
      exportMeta: {
        description: 'Edited description',
        title: 'Edited title',
      },
    }

    const materialized = materializeReplaySession(session, draft)

    expect(materialized.title).toBe('Edited title')
    expect(materialized.description).toBe('Edited description')
    expect(getTextBlock(materialized.turns[1]?.blocks[0]).text).toBe('Edited assistant text')
    expect(materialized.turns[1]?.included).toBe(false)
    expect(materialized.bookmarks).toEqual([
      {
        id: 'bookmark:turn-3',
        label: 'Final answer',
        turnIndex: 1,
      },
    ])
    expect(materialized.turns[1]?.blocks[2]).toBe(session.turns[1]?.blocks[2])
    expect(getTextBlock(session.turns[1]?.blocks[0]).text).toBe('Draft me later')
  })

  it('derives render options from client-side viewer state', () => {
    const session = createFixtureSession()
    const draft = {
      ...createEmptySessionDraft({
        baseRevision: 'revision-1',
        sessionId: session.id,
      }),
      excludedTurnIds: ['turn-2'],
      exportMeta: {
        title: 'Edited title',
      },
      viewerOptions: {
        autoplayDelayMs: 900,
        includeThinking: true,
        includeTimestamps: true,
        includeToolCalls: false,
        initialTurnId: 'turn-3',
        revealThinking: false,
      },
    }

    expect(materializeReplayRenderOptions(session, draft)).toEqual({
      autoplayDelayMs: 900,
      exportTitle: 'Edited title',
      includeThinking: true,
      keepTimestamps: true,
      includeToolCalls: false,
      initialTurnIndex: 1,
      revealThinking: false,
    })

    expect(materializeReplayRenderRequest(session, draft).options).toEqual({
      autoplayDelayMs: 900,
      exportTitle: 'Edited title',
      includeThinking: true,
      keepTimestamps: true,
      includeToolCalls: false,
      initialTurnIndex: 1,
      revealThinking: false,
    })
  })
})
