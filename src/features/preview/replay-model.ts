import type { MaterializedReplaySession, ReplayRole } from '../../lib/api/contracts'
import type { PreparedTranscriptLayout } from '../../lib/replay/transcript-layout-types'

export type PreviewTurnRole = ReplayRole

export type PreviewTurn = {
  blocks: MaterializedReplaySession['turns'][number]['blocks']
  bookmarkLabel?: string
  id: string
  index?: number
  role: PreviewTurnRole
  summary: string
  timestamp: string
  isHidden?: boolean
  isBookmarked?: boolean
  previewText?: string
  timeLabel: string
}

export type ReplaySession = {
  id: string
  provider: string
  project: string
  title: string
  cwd: string
  updatedAt: string
  turnCount: number
  turns: PreviewTurn[]
}

export function buildReplaySession(
  session: MaterializedReplaySession,
  transcriptLayout: PreparedTranscriptLayout,
  options: {
    bookmarkLabelsByTurnId?: ReadonlyMap<string, string>
    providerLabel?: string
  } = {},
): ReplaySession {
  const turns: PreviewTurn[] = session.turns.map((turn) => {
    const isHidden = turn.included === false
    const bookmarkLabel = options.bookmarkLabelsByTurnId?.get(turn.id)
    const turnLayout = transcriptLayout.turnLayoutById.get(turn.id)
    if (!turnLayout) {
      throw new Error(`Missing prepared transcript layout for turn ${turn.id}`)
    }

    return {
      blocks: turn.blocks,
      bookmarkLabel,
      id: turn.id,
      index: turn.index,
      role: turn.role,
      isBookmarked: Boolean(bookmarkLabel),
      isHidden,
      previewText: turnLayout.previewText,
      summary: turnLayout.summary,
      timestamp: turn.timestamp ?? '',
      timeLabel: formatTimeLabel(turn.timestamp),
    }
  })

  return {
    id: session.id,
    provider: options.providerLabel ?? session.source,
    project: session.project ?? 'Unknown project',
    cwd: session.cwd ?? '',
    title: session.title,
    updatedAt: session.updatedAt ?? '',
    turnCount: turns.length,
    turns,
  }
}

function formatTimeLabel(timestamp?: string | null): string {
  if (!timestamp) {
    return ''
  }

  const time = new Date(timestamp)
  if (Number.isNaN(time.valueOf())) {
    return timestamp
  }

  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
