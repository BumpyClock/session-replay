import type { MaterializedReplaySession } from '../api/contracts'

export const DEFAULT_VIEWER_OPTIONS = {
  includeThinking: false,
  includeToolCalls: true,
  includeTimestamps: true,
  revealThinking: false,
} as const satisfies EditorViewerOptions

export interface EditorExportMeta {
  description?: string
  fileName?: string
  title?: string
}

export interface EditorViewerOptions {
  autoplayDelayMs?: number
  includeThinking: boolean
  includeTimestamps: boolean
  includeToolCalls: boolean
  initialTurnId?: string
  revealThinking: boolean
}

export interface SessionDraftBookmark {
  label: string
}

export interface SessionDraft {
  baseRevision: string
  blockTextEdits: Record<string, Record<string, string>>
  bookmarks: Record<string, SessionDraftBookmark>
  excludedTurnIds: string[]
  exportMeta: EditorExportMeta
  sessionId: string
  viewerOptions: EditorViewerOptions
}

export interface EditorStoreState {
  drafts: Record<string, SessionDraft>
  clearBlockText: (
    sessionId: string,
    baseRevision: string,
    turnId: string,
    blockId: string,
  ) => void
  ensureDraft: (sessionId: string, baseRevision: string) => SessionDraft
  removeBookmark: (sessionId: string, baseRevision: string, turnId: string) => void
  resetAllDrafts: () => void
  resetDraft: (sessionId: string) => void
  setBlockText: (
    sessionId: string,
    baseRevision: string,
    turnId: string,
    blockId: string,
    text: string,
  ) => void
  setBookmark: (
    sessionId: string,
    baseRevision: string,
    turnId: string,
    label: string,
  ) => void
  setExportMeta: (
    sessionId: string,
    baseRevision: string,
    patch: Partial<EditorExportMeta>,
  ) => void
  setTurnIncluded: (
    sessionId: string,
    baseRevision: string,
    turnId: string,
    included: boolean,
  ) => void
  setViewerOptions: (
    sessionId: string,
    baseRevision: string,
    patch: Partial<EditorViewerOptions>,
  ) => void
  toggleTurnIncluded: (
    sessionId: string,
    baseRevision: string,
    turnId: string,
  ) => void
}

export interface CreateSessionDraftInput {
  baseRevision: string
  sessionId: string
}

export type PersistedEditorStoreState = Pick<EditorStoreState, 'drafts'>

export function createEmptySessionDraft(
  input: CreateSessionDraftInput,
): SessionDraft {
  return {
    baseRevision: input.baseRevision,
    blockTextEdits: {},
    bookmarks: {},
    excludedTurnIds: [],
    exportMeta: {},
    sessionId: input.sessionId,
    viewerOptions: {
      ...DEFAULT_VIEWER_OPTIONS,
    },
  }
}

export function getSessionDraft(
  drafts: Record<string, SessionDraft>,
  sessionId: string,
): SessionDraft | undefined {
  return drafts[sessionId]
}

export function resolveSessionDraft(
  drafts: Record<string, SessionDraft>,
  sessionId: string,
  baseRevision: string,
): SessionDraft {
  const existingDraft = drafts[sessionId]

  if (!existingDraft || existingDraft.baseRevision !== baseRevision) {
    return createEmptySessionDraft({ baseRevision, sessionId })
  }

  return existingDraft
}

export function getSessionBaseRevision(
  session: Pick<MaterializedReplaySession, 'id' | 'updatedAt'>,
): string {
  return `${session.id}:${session.updatedAt ?? 'unknown'}`
}
