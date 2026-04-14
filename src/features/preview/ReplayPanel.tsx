import { Check, ChevronDown, Clock, MessageSquare, Wrench, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReplayBlock } from '../../lib/api/contracts'
import { renderReplayBlockBodyHtml } from '../../lib/markdown'
import {
  getReplayBlockLabel,
  getReplayBlockSummaryMeta,
  getReplayTurnTone,
} from '../../lib/replay/blocks'
import {
  createReplaySegments,
  getReplaySegmentDefaultOpen,
  getReplaySegmentDisclosureIds,
  getReplayToolRunLabel,
  getReplayToolRunSummaryMeta,
  shouldGroupReplayToolRun,
  type ReplaySegment,
} from '../../lib/replay/segments'

export type PreviewTurnRole = 'user' | 'assistant' | 'tool'

export type PreviewTurn = {
  blocks: ReplayBlock[]
  id: string
  role: PreviewTurnRole
  summary: string
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
  const [expandedTurnIds, setExpandedTurnIds] = useState<Set<string>>(new Set())
  const [expandedBlockIds, setExpandedBlockIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!session) {
      setExpandedTurnIds(new Set())
      setExpandedBlockIds(new Set())
      return
    }

    setExpandedTurnIds(new Set(session.turns.map((turn) => turn.id)))
    setExpandedBlockIds(
      new Set(
        session.turns.flatMap((turn) =>
          createReplaySegments(turn.blocks).flatMap((segment) =>
            getReplaySegmentDefaultOpen(segment) ? getReplaySegmentDisclosureIds(segment) : [],
          ),
        ),
      ),
    )
  }, [session?.id])

  const expandAll = () => {
    if (!session) {
      return
    }

    setExpandedTurnIds(new Set(session.turns.map((turn) => turn.id)))
    setExpandedBlockIds(
      new Set(
        session.turns.flatMap((turn) =>
          createReplaySegments(turn.blocks).flatMap((segment) => getReplaySegmentDisclosureIds(segment)),
        ),
      ),
    )
  }

  const collapseAll = () => {
    setExpandedTurnIds(new Set())
    setExpandedBlockIds(new Set())
  }

  const toggleTurn = (turnId: string) => {
    setExpandedTurnIds((current) => {
      const next = new Set(current)
      if (next.has(turnId)) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return next
    })
  }

  const toggleBlock = (blockId: string) => {
    setExpandedBlockIds((current) => {
      const next = new Set(current)
      if (next.has(blockId)) {
        next.delete(blockId)
      } else {
        next.add(blockId)
      }
      return next
    })
  }

  return (
    <section className="preview-block" aria-live="polite">
      <header className="preview-block__header">
        <div>
          <p className="eyebrow">Replay preview</p>
          <h2>{session ? 'Session playback' : 'Select a session'}</h2>
        </div>
        <div className="preview-block__meta">
          <div className="preview-block__count">
            <Clock size={14} strokeWidth={1.8} />
            {visibleCount}/{totalCount} visible
          </div>
          {session ? (
            <div className="preview-block__controls">
              <button className="preview-block__action" type="button" onClick={expandAll}>
                Expand all
              </button>
              <button className="preview-block__action" type="button" onClick={collapseAll}>
                Collapse all
              </button>
            </div>
          ) : null}
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
              const turnTone = getReplayTurnTone(turn)
              const isTurnOpen = expandedTurnIds.has(turn.id)
              return (
                <li
                  key={turn.id}
                  className={`replay-turn replay-turn--${turnTone} ${turn.isHidden ? 'is-hidden' : ''}`}
                >
                  <div className="replay-turn__icon">
                    <Icon size={12} strokeWidth={1.8} />
                  </div>
                  <div className="replay-turn__meta">
                    <p className="replay-turn__top">
                      <span>{turn.role}</span>
                      <span>{turn.timeLabel}</span>
                    </p>
                    <details className="replay-turn__details" open={isTurnOpen}>
                      <summary
                        className="replay-turn__summary"
                        onClick={(event) => {
                          event.preventDefault()
                          toggleTurn(turn.id)
                        }}
                      >
                        <ChevronDown size={12} className={`replay-turn__chevron ${isTurnOpen ? 'is-open' : ''}`} />
                        <span className="replay-turn__summary-label">{turn.summary}</span>
                      </summary>
                      <div className="replay-turn__body">
                        {createReplaySegments(turn.blocks).map((segment) => (
                          <ReplaySegmentDisclosure
                            key={segment.id}
                            expandedBlockIds={expandedBlockIds}
                            segment={segment}
                            onToggle={toggleBlock}
                          />
                        ))}
                      </div>
                    </details>
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

function ReplaySegmentDisclosure({
  expandedBlockIds,
  onToggle,
  segment,
}: {
  expandedBlockIds: ReadonlySet<string>
  onToggle: (id: string) => void
  segment: ReplaySegment
}) {
  if (segment.type === 'block') {
    if (segment.block.type !== 'thinking') {
      return <ReplayInlineBlock block={segment.block} />
    }

    return (
      <ReplayBlockDisclosure
        block={segment.block}
        isOpen={expandedBlockIds.has(segment.block.id)}
        onToggle={() => onToggle(segment.block.id)}
      />
    )
  }

  if (!shouldGroupReplayToolRun(segment)) {
    return (
      <div className="replay-tool-run">
        {segment.blocks.map((block) => (
          <ReplayBlockDisclosure
            key={block.id}
            block={block}
            isOpen={expandedBlockIds.has(block.id)}
            onToggle={() => onToggle(block.id)}
          />
        ))}
      </div>
    )
  }

  const isOpen = expandedBlockIds.has(segment.id)
  const summaryMeta = getReplayToolRunSummaryMeta(segment)

  return (
    <details className="replay-tool-group" open={isOpen}>
      <summary
        className="replay-tool-group__summary"
        onClick={(event) => {
          event.preventDefault()
          onToggle(segment.id)
        }}
      >
        <ChevronDown size={12} className={`replay-tool-group__chevron ${isOpen ? 'is-open' : ''}`} />
        <span className="replay-tool-group__label">{getReplayToolRunLabel(segment)}</span>
        {summaryMeta ? <span className="replay-tool-group__meta">{summaryMeta}</span> : null}
      </summary>
      <div className="replay-tool-group__content">
        {segment.blocks.map((block) => (
          <ReplayBlockDisclosure
            key={block.id}
            block={block}
            isOpen={expandedBlockIds.has(block.id)}
            onToggle={() => onToggle(block.id)}
          />
        ))}
      </div>
    </details>
  )
}

function ReplayInlineBlock({ block }: { block: Exclude<ReplayBlock, { type: 'tool' }> }) {
  return (
    <div className={`replay-inline-block replay-inline-block--${block.type}`}>
      {block.title ? <div className="replay-inline-block__title">{block.title}</div> : null}
      <div
        className="replay-inline-block__content"
        dangerouslySetInnerHTML={{ __html: renderReplayBlockBodyHtml(block) }}
      />
    </div>
  )
}

function ReplayBlockDisclosure({
  block,
  isOpen,
  onToggle,
}: {
  block: ReplayBlock
  isOpen: boolean
  onToggle: () => void
}) {
  const summaryMeta = getReplayBlockSummaryMeta(block)
  const contentClassName =
    block.type === 'tool'
      ? 'replay-disclosure__content replay-disclosure__content--tool'
      : 'replay-disclosure__content'

  return (
    <details className={`replay-disclosure replay-disclosure--${block.type}`} open={isOpen}>
      <summary
        className="replay-disclosure__summary"
        onClick={(event) => {
          event.preventDefault()
          onToggle()
        }}
      >
        <ChevronDown size={12} className={`replay-disclosure__chevron ${isOpen ? 'is-open' : ''}`} />
        <span className="replay-disclosure__summary-label">{getReplayBlockLabel(block)}</span>
        {summaryMeta ? <span className="replay-disclosure__summary-meta">{summaryMeta}</span> : null}
      </summary>
      <div
        className={contentClassName}
        dangerouslySetInnerHTML={{ __html: renderReplayBlockBodyHtml(block) }}
      />
    </details>
  )
}

export { ReplayPanel }
