import { useStore } from 'zustand'
import { createJSONStorage, persist, type PersistOptions, type StateStorage } from 'zustand/middleware'
import { createStore, type StoreApi } from 'zustand/vanilla'

export type BrowserUpdatedWithin = 'all' | 'today' | '7d' | '30d' | 'older'
export type BrowserTurnLength = 'short' | 'medium' | 'long'

export type BrowserFilters = {
  agentIds: string[]
  projectIds: string[]
  requireCwd: boolean
  requirePath: boolean
  turnLengths: BrowserTurnLength[]
  updatedWithin: BrowserUpdatedWithin
}

export type BrowserPrefsState = {
  collapsedProjectIds: string[]
  filters: BrowserFilters
  ignoredProjectIds: string[]
  pinnedProjectIds: string[]
  clearFilters: () => void
  restoreIgnoredProject: (projectId: string) => void
  toggleAgentFilter: (agentId: string) => void
  toggleCollapsedProject: (projectId: string) => void
  toggleIgnoredProject: (projectId: string) => void
  togglePinnedProject: (projectId: string) => void
  toggleProjectFilter: (projectId: string) => void
  toggleTurnLength: (turnLength: BrowserTurnLength) => void
  setRequireCwd: (required: boolean) => void
  setRequirePath: (required: boolean) => void
  setUpdatedWithin: (updatedWithin: BrowserUpdatedWithin) => void
}

type PersistedBrowserPrefsState = Pick<
  BrowserPrefsState,
  'collapsedProjectIds' | 'filters' | 'ignoredProjectIds' | 'pinnedProjectIds'
>

const DEFAULT_PERSIST_KEY = 'session-replay-browser-prefs'

const DEFAULT_FILTERS: BrowserFilters = {
  agentIds: [],
  projectIds: [],
  requireCwd: false,
  requirePath: false,
  turnLengths: [],
  updatedWithin: 'all',
}

const noopStorage: StateStorage = {
  getItem: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
}

type BrowserPrefsPersist = PersistOptions<BrowserPrefsState, PersistedBrowserPrefsState>

export interface CreateBrowserPrefsStoreOptions {
  persistKey?: string
  storage?: BrowserPrefsPersist['storage']
}

function getBrowserStorage(): StateStorage {
  if (typeof window === 'undefined') {
    return noopStorage
  }

  const candidate = window.localStorage

  if (
    !candidate
    || typeof candidate.getItem !== 'function'
    || typeof candidate.setItem !== 'function'
    || typeof candidate.removeItem !== 'function'
  ) {
    return noopStorage
  }

  return candidate
}

export function createBrowserPrefsStore(
  options: CreateBrowserPrefsStoreOptions = {},
): StoreApi<BrowserPrefsState> {
  return createStore<BrowserPrefsState>()(
    persist(
      (set) => ({
        collapsedProjectIds: [],
        filters: DEFAULT_FILTERS,
        ignoredProjectIds: [],
        pinnedProjectIds: [],
        clearFilters: () => {
          set((state) => ({
            ...state,
            filters: DEFAULT_FILTERS,
          }))
        },
        restoreIgnoredProject: (projectId) => {
          set((state) => ({
            ...state,
            ignoredProjectIds: state.ignoredProjectIds.filter((candidate) => candidate !== projectId),
          }))
        },
        toggleAgentFilter: (agentId) => {
          set((state) => ({
            ...state,
            filters: {
              ...state.filters,
              agentIds: toggleListValue(state.filters.agentIds, agentId),
            },
          }))
        },
        toggleCollapsedProject: (projectId) => {
          set((state) => ({
            ...state,
            collapsedProjectIds: toggleListValue(state.collapsedProjectIds, projectId),
          }))
        },
        toggleIgnoredProject: (projectId) => {
          set((state) => {
            const nextIgnored = toggleListValue(state.ignoredProjectIds, projectId)

            return {
              ...state,
              filters: {
                ...state.filters,
                projectIds: state.filters.projectIds.filter((candidate) => candidate !== projectId),
              },
              ignoredProjectIds: nextIgnored,
              pinnedProjectIds: state.pinnedProjectIds.filter((candidate) => candidate !== projectId),
            }
          })
        },
        togglePinnedProject: (projectId) => {
          set((state) => ({
            ...state,
            ignoredProjectIds: state.ignoredProjectIds.filter((candidate) => candidate !== projectId),
            pinnedProjectIds: toggleListValue(state.pinnedProjectIds, projectId),
          }))
        },
        toggleProjectFilter: (projectId) => {
          set((state) => ({
            ...state,
            filters: {
              ...state.filters,
              projectIds: toggleListValue(state.filters.projectIds, projectId),
            },
          }))
        },
        toggleTurnLength: (turnLength) => {
          set((state) => ({
            ...state,
            filters: {
              ...state.filters,
              turnLengths: toggleListValue(state.filters.turnLengths, turnLength),
            },
          }))
        },
        setRequireCwd: (required) => {
          set((state) => ({
            ...state,
            filters: {
              ...state.filters,
              requireCwd: required,
            },
          }))
        },
        setRequirePath: (required) => {
          set((state) => ({
            ...state,
            filters: {
              ...state.filters,
              requirePath: required,
            },
          }))
        },
        setUpdatedWithin: (updatedWithin) => {
          set((state) => ({
            ...state,
            filters: {
              ...state.filters,
              updatedWithin,
            },
          }))
        },
      }),
      {
        name: options.persistKey ?? DEFAULT_PERSIST_KEY,
        partialize: (state) => ({
          collapsedProjectIds: state.collapsedProjectIds,
          filters: state.filters,
          ignoredProjectIds: state.ignoredProjectIds,
          pinnedProjectIds: state.pinnedProjectIds,
        }),
        storage:
          options.storage
          ?? createJSONStorage<PersistedBrowserPrefsState>(() => getBrowserStorage()),
        version: 1,
      },
    ),
  )
}

function toggleListValue<T extends string>(values: T[], nextValue: T): T[] {
  return values.includes(nextValue)
    ? values.filter((candidate) => candidate !== nextValue)
    : [...values, nextValue]
}

export const browserPrefsStore = createBrowserPrefsStore()

export function useBrowserPrefsStore<T>(selector: (state: BrowserPrefsState) => T): T {
  return useStore(browserPrefsStore, selector)
}

export { DEFAULT_FILTERS }