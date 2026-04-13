import type {
  MaterializedReplaySession,
  ReplayBookmark,
  ReplayRenderOptions,
  SessionRenderRequest,
} from '../api/contracts'
import { resolveSessionDraft, type SessionDraft } from './types'

export function materializeReplaySession(
  session: Readonly<MaterializedReplaySession>,
  draft?: Readonly<SessionDraft>,
): MaterializedReplaySession {
  const resolvedDraft = draft
    ? resolveSessionDraft(
        { [draft.sessionId]: draft as SessionDraft },
        session.id,
        draft.baseRevision,
      )
    : undefined
  const excludedTurnIds = new Set(resolvedDraft?.excludedTurnIds ?? [])
  const materializedTurns = session.turns.map((turn) => {
    const turnBlockEdits = resolvedDraft?.blockTextEdits[turn.id]
    const blocks = turn.blocks.map((block) => {
      const editedText = turnBlockEdits?.[block.id]

      if (editedText === undefined) {
        return block
      }

      return {
        ...block,
        text: editedText,
      }
    })

    return {
      ...turn,
      blocks,
      included: !excludedTurnIds.has(turn.id),
      toolCalls: turn.toolCalls,
    }
  })

  return {
    ...session,
    bookmarks: materializeBookmarks(materializedTurns, resolvedDraft),
    description: resolvedDraft?.exportMeta.description ?? session.description,
    title: resolvedDraft?.exportMeta.title ?? session.title,
    turns: materializedTurns,
  }
}

export function materializeReplayRenderOptions(
  session: Readonly<MaterializedReplaySession>,
  draft?: Readonly<SessionDraft>,
): ReplayRenderOptions {
  const resolvedDraft = draft
    ? resolveSessionDraft(
        { [draft.sessionId]: draft as SessionDraft },
        session.id,
        draft.baseRevision,
      )
    : undefined
  const materializedSession = materializeReplaySession(session, resolvedDraft)
  const initialTurnIndex = resolveInitialTurnIndex(materializedSession, resolvedDraft)

  return {
    autoplayDelayMs: resolvedDraft?.viewerOptions.autoplayDelayMs,
    exportTitle: resolvedDraft?.exportMeta.title ?? session.title,
    includeThinking: resolvedDraft?.viewerOptions.includeThinking,
    includeToolCalls: resolvedDraft?.viewerOptions.includeToolCalls,
    initialTurnIndex,
    keepTimestamps: resolvedDraft?.viewerOptions.includeTimestamps,
    revealThinking: resolvedDraft?.viewerOptions.revealThinking,
  }
}

export function materializeReplayRenderRequest(
  session: Readonly<MaterializedReplaySession>,
  draft?: Readonly<SessionDraft>,
): SessionRenderRequest {
  return {
    options: materializeReplayRenderOptions(session, draft),
    session: materializeReplaySession(session, draft),
  }
}

function materializeBookmarks(
  turns: MaterializedReplaySession['turns'],
  draft?: Readonly<SessionDraft>,
): ReplayBookmark[] | undefined {
  if (!draft) {
    return undefined
  }

  const visibleTurnIndexes = new Map<string, number>()
  let visibleIndex = 0

  turns.forEach((turn) => {
    if (turn.included !== false) {
      visibleTurnIndexes.set(turn.id, visibleIndex)
      visibleIndex += 1
    }
  })

  const bookmarks = Object.entries(draft.bookmarks)
    .map(([turnId, bookmark]) => {
      const turnIndex = visibleTurnIndexes.get(turnId)

      if (turnIndex === undefined) {
        return null
      }

      return {
        id: `bookmark:${turnId}`,
        label: bookmark.label,
        turnIndex,
      } satisfies ReplayBookmark
    })
    .filter((bookmark): bookmark is ReplayBookmark => bookmark !== null)
    .sort((left, right) => left.turnIndex - right.turnIndex)

  return bookmarks.length > 0 ? bookmarks : undefined
}

function resolveInitialTurnIndex(
  session: MaterializedReplaySession,
  draft?: Readonly<SessionDraft>,
): number | undefined {
  const initialTurnId = draft?.viewerOptions.initialTurnId

  if (!initialTurnId) {
    return undefined
  }

  let visibleIndex = 0

  for (const turn of session.turns) {
    if (turn.included === false) {
      continue
    }

    if (turn.id === initialTurnId) {
      return visibleIndex
    }

    visibleIndex += 1
  }

  return undefined
}
