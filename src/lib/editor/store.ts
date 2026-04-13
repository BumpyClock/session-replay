import { useStore } from 'zustand'
import { createJSONStorage, persist, type PersistOptions, type StateStorage } from 'zustand/middleware'
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  getSessionDraft,
  resolveSessionDraft,
  type EditorExportMeta,
  type EditorStoreState,
  type EditorViewerOptions,
  type PersistedEditorStoreState,
  type SessionDraft,
} from './types'

const DEFAULT_PERSIST_KEY = 'session-replay-editor-drafts'

const noopStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
}

function getBrowserStorage(): StateStorage {
  if (typeof window === 'undefined') {
    return noopStorage
  }

  const candidate = window.localStorage

  if (
    !candidate ||
    typeof candidate.getItem !== 'function' ||
    typeof candidate.setItem !== 'function' ||
    typeof candidate.removeItem !== 'function'
  ) {
    return noopStorage
  }

  return candidate
}

type EditorStorePersist = PersistOptions<
  EditorStoreState,
  PersistedEditorStoreState
>

export interface CreateEditorStoreOptions {
  persistKey?: string
  storage?: EditorStorePersist['storage']
}

export function createEditorStore(
  options: CreateEditorStoreOptions = {},
): StoreApi<EditorStoreState> {
  return createStore<EditorStoreState>()(
    persist(createEditorStoreState(), {
      name: options.persistKey ?? DEFAULT_PERSIST_KEY,
      partialize: (state) => ({
        drafts: state.drafts,
      }),
      storage:
        options.storage ??
        createJSONStorage<PersistedEditorStoreState>(() => getBrowserStorage()),
      version: 1,
    }),
  )
}

export const editorStore = createEditorStore()

export function useEditorStore<T>(
  selector: (state: EditorStoreState) => T,
): T {
  return useStore(editorStore, selector)
}

function createEditorStoreState(): (
  set: (
    partial:
      | EditorStoreState
      | Partial<EditorStoreState>
      | ((state: EditorStoreState) => EditorStoreState | Partial<EditorStoreState>),
    replace?: false,
  ) => void,
  get: () => EditorStoreState,
) => EditorStoreState {
  return (set, get) => ({
    clearBlockText: (sessionId, baseRevision, turnId, blockId) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => {
        const turnEdits = draft.blockTextEdits[turnId]

        if (!turnEdits || !(blockId in turnEdits)) {
          return draft
        }

        const nextTurnEdits = { ...turnEdits }
        delete nextTurnEdits[blockId]

        const nextBlockTextEdits = { ...draft.blockTextEdits }

        if (Object.keys(nextTurnEdits).length === 0) {
          delete nextBlockTextEdits[turnId]
        } else {
          nextBlockTextEdits[turnId] = nextTurnEdits
        }

        return {
          ...draft,
          blockTextEdits: nextBlockTextEdits,
        }
      })
    },
    drafts: {},
    ensureDraft: (sessionId, baseRevision) => {
      const nextDraft = resolveSessionDraft(get().drafts, sessionId, baseRevision)

      if (getSessionDraft(get().drafts, sessionId) !== nextDraft) {
        set((state) => ({
          drafts: {
            ...state.drafts,
            [sessionId]: nextDraft,
          },
        }))
      }

      return nextDraft
    },
    removeBookmark: (sessionId, baseRevision, turnId) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => {
        if (!(turnId in draft.bookmarks)) {
          return draft
        }

        const nextBookmarks = { ...draft.bookmarks }
        delete nextBookmarks[turnId]

        return {
          ...draft,
          bookmarks: nextBookmarks,
        }
      })
    },
    resetAllDrafts: () => {
      set({ drafts: {} })
    },
    resetDraft: (sessionId) => {
      set((state) => {
        if (!(sessionId in state.drafts)) {
          return state
        }

        const nextDrafts = { ...state.drafts }
        delete nextDrafts[sessionId]

        return {
          drafts: nextDrafts,
        }
      })
    },
    setBlockText: (sessionId, baseRevision, turnId, blockId, text) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => ({
        ...draft,
        blockTextEdits: {
          ...draft.blockTextEdits,
          [turnId]: {
            ...draft.blockTextEdits[turnId],
            [blockId]: text,
          },
        },
      }))
    },
    setBookmark: (sessionId, baseRevision, turnId, label) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => ({
        ...draft,
        bookmarks: {
          ...draft.bookmarks,
          [turnId]: {
            label,
          },
        },
      }))
    },
    setExportMeta: (sessionId, baseRevision, patch) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => ({
        ...draft,
        exportMeta: mergeDefined(draft.exportMeta, patch),
      }))
    },
    setTurnIncluded: (sessionId, baseRevision, turnId, included) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => ({
        ...draft,
        excludedTurnIds: updateExcludedTurnIds(draft.excludedTurnIds, turnId, included),
      }))
    },
    setViewerOptions: (sessionId, baseRevision, patch) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => ({
        ...draft,
        viewerOptions: mergeDefined(draft.viewerOptions, patch),
      }))
    },
    toggleTurnIncluded: (sessionId, baseRevision, turnId) => {
      updateDraft(set, get, sessionId, baseRevision, (draft) => ({
        ...draft,
        excludedTurnIds: draft.excludedTurnIds.includes(turnId)
          ? draft.excludedTurnIds.filter((candidate) => candidate !== turnId)
          : [...draft.excludedTurnIds, turnId],
      }))
    },
  })
}

function updateDraft(
  set: (
    partial:
      | EditorStoreState
      | Partial<EditorStoreState>
      | ((state: EditorStoreState) => EditorStoreState | Partial<EditorStoreState>),
    replace?: false,
  ) => void,
  get: () => EditorStoreState,
  sessionId: string,
  baseRevision: string,
  updater: (draft: SessionDraft) => SessionDraft,
): void {
  const currentDraft = resolveSessionDraft(get().drafts, sessionId, baseRevision)
  const nextDraft = updater(currentDraft)

  set((state) => ({
    drafts: {
      ...state.drafts,
      [sessionId]: nextDraft,
    },
  }))
}

function updateExcludedTurnIds(
  excludedTurnIds: string[],
  turnId: string,
  included: boolean,
): string[] {
  if (included) {
    return excludedTurnIds.filter((candidate) => candidate !== turnId)
  }

  return excludedTurnIds.includes(turnId)
    ? excludedTurnIds
    : [...excludedTurnIds, turnId]
}

function mergeDefined<T extends EditorExportMeta | EditorViewerOptions>(
  current: T,
  patch: Partial<T>,
): T {
  const next = { ...current } as T

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key as keyof T]
      continue
    }

    next[key as keyof T] = value as T[keyof T]
  }

  return next
}
