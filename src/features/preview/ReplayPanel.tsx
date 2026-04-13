import { Check, Clock, MessageSquare, Wrench, UserRound } from 'lucide-react'

export type PreviewTurnRole = 'user' | 'assistant' | 'tool'

export type PreviewTurn = {
  bodyHtml: string
  id: string
  role: PreviewTurnRole
  timestamp: string
  isHidden?: boolean
  isBookmarked?: boolean
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

export type ReplayPanelProps = {
  session: ReplaySession | null
  visibleCount: number
  totalCount: number
}

const roleIconMap: Record<PreviewTurn['role'], typeof MessageSquare> = {
  user: UserRound,
  assistant: Check,
  tool: Wrench,
}

function ReplayPanel({ session, visibleCount, totalCount }: ReplayPanelProps) {
  return (
    <section className="preview-block" aria-live="polite">
      <header className="preview-block__header">
        <div>
          <p className="eyebrow">Replay preview</p>
          <h2>{session ? 'Session playback' : 'Select a session'}</h2>
        </div>
        <div className="preview-block__count">
          <Clock size={14} strokeWidth={1.8} />
          {visibleCount}/{totalCount} visible
        </div>
      </header>

      <div className="preview-block__content">
        {!session ? (
          <div className="preview-block__empty">
            <p>No session selected.</p>
            <p className="preview-block__hint">
              Pick a session from the browser rail to preview timeline turns
            </p>
          </div>
        ) : (
          <ul>
            {session.turns.map((turn) => {
              const Icon = roleIconMap[turn.role]
              return (
                <li key={turn.id} className={`replay-turn ${turn.isHidden ? 'is-hidden' : ''}`}>
                  <div className="replay-turn__icon">
                    <Icon size={12} strokeWidth={1.8} />
                  </div>
                  <div className="replay-turn__meta">
                    <p className="replay-turn__top">
                      <span>{turn.role}</span>
                      <span>{turn.timeLabel}</span>
                    </p>
                    <div
                      className="replay-turn__body"
                      dangerouslySetInnerHTML={{ __html: turn.bodyHtml }}
                    />
                    {turn.isBookmarked ? <span className="replay-turn__bookmark">bookmarked</span> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

export { ReplayPanel }
