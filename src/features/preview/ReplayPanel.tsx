import { Bookmark, Bot, ChevronDown, Clock, Eye, EyeOff, MessageSquare, Wrench, UserRound } from 'lucide-react'
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
import { type ReplayRenderableBlock, type ReplayRenderableTextBlock } from '../../lib/replay/context-blocks'

export type PreviewTurnRole = 'user' | 'assistant' | 'tool'

export type PreviewTurn = {
  blocks: ReplayBlock[]
  bookmarkLabel?: string
  id: string
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

export type ReplayPanelProps = {
  session: ReplaySession | null
  visibleCount: number
  totalCount: number
  onBookmarkChange?: (turnId: string, nextLabel: string) => void
  onToggleTurnIncluded?: (turnId: string) => void
}

const roleIconMap: Record<PreviewTurn['role'], typeof MessageSquare> = {
  user: UserRound,
  assistant: Bot,
  tool: Wrench,
}

function ReplayPanel({
  session,
  visibleCount,
  totalCount,
  onBookmarkChange,
  onToggleTurnIncluded,
}: ReplayPanelProps) {
  const [expandedBlockIds, setExpandedBlockIds] = useState<Set<string>>(new Set())
  const [editingNoteTurnId, setEditingNoteTurnId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  useEffect(() => {
    if (!session) {
      setExpandedBlockIds(new Set())
      setEditingNoteTurnId(null)
      setNoteDraft('')
      return
    }

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

  useEffect(() => {
    if (!editingNoteTurnId || !session) {
      return
    }

    const currentTurn = session.turns.find((turn) => turn.id === editingNoteTurnId)
    if (!currentTurn) {
      setEditingNoteTurnId(null)
      setNoteDraft('')
      return
    }

    setNoteDraft(currentTurn.bookmarkLabel ?? '')
  }, [editingNoteTurnId, session])

  const expandAll = () => {
    if (!session) {
      return
    }

    setExpandedBlockIds(
      new Set(
        session.turns.flatMap((turn) =>
          createReplaySegments(turn.blocks).flatMap((segment) => getReplaySegmentDisclosureIds(segment)),
        ),
      ),
    )
  }

  const collapseAll = () => {
    setExpandedBlockIds(new Set())
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

  const openNoteEditor = (turn: PreviewTurn) => {
    setEditingNoteTurnId(turn.id)
    setNoteDraft(turn.bookmarkLabel ?? '')
  }

  const closeNoteEditor = () => {
    setEditingNoteTurnId(null)
    setNoteDraft('')
  }

  const commitNoteEditor = () => {
    if (!editingNoteTurnId || !onBookmarkChange) {
      closeNoteEditor()
      return
    }

    onBookmarkChange(editingNoteTurnId, noteDraft)
    closeNoteEditor()
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
              return (
                <li
                  key={turn.id}
                  className={`replay-turn replay-turn--${turnTone} ${turn.isHidden ? 'is-hidden' : ''}`}
                >
                  <div className="replay-turn__icon">
                    <Icon size={12} strokeWidth={1.8} />
                  </div>
                  <div className="replay-turn__meta">
                    <div className="replay-turn__header">
                      <div className="replay-turn__top">
                        <span className="replay-turn__role-label">{formatPreviewRoleLabel(turn.role)}</span>
                        <span className="replay-turn__summary-inline">{turn.summary}</span>
                        <div className="replay-turn__controls">
                          <button
                            aria-label={turn.bookmarkLabel ? 'Edit bookmark note' : 'Add bookmark note'}
                            className={`replay-turn__icon-button ${turn.isBookmarked ? 'is-active' : ''}`}
                            type="button"
                            onClick={() => openNoteEditor(turn)}
                          >
                            <Bookmark size={14} strokeWidth={1.8} />
                          </button>
                          <button
                            aria-label={turn.isHidden ? 'Show turn in preview and export' : 'Hide turn from preview and export'}
                            className={`replay-turn__icon-button ${turn.isHidden ? 'is-active' : ''}`}
                            type="button"
                            onClick={() => onToggleTurnIncluded?.(turn.id)}
                          >
                            {turn.isHidden ? <Eye size={14} strokeWidth={1.8} /> : <EyeOff size={14} strokeWidth={1.8} />}
                          </button>
                        </div>
                      </div>
                      {turn.timeLabel ? <p className="replay-turn__timestamp">{turn.timeLabel}</p> : null}
                      {editingNoteTurnId === turn.id ? (
                        <div className="replay-turn__note-editor">
                          <input
                            aria-label={`Bookmark note for ${turn.id}`}
                            autoFocus
                            className="replay-turn__note-input"
                            placeholder="Add note for export bookmark"
                            value={noteDraft}
                            onBlur={commitNoteEditor}
                            onChange={(event) => setNoteDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                commitNoteEditor()
                              }

                              if (event.key === 'Escape') {
                                event.preventDefault()
                                closeNoteEditor()
                              }
                            }}
                          />
                        </div>
                      ) : turn.bookmarkLabel ? (
                        <button
                          className="replay-turn__note-pill"
                          type="button"
                          onClick={() => openNoteEditor(turn)}
                        >
                          <Bookmark size={12} strokeWidth={1.8} />
                          {turn.bookmarkLabel}
                        </button>
                      ) : null}
                    </div>
                    {turn.isHidden ? (
                      <div className="replay-turn__collapsed-preview">
                        <span className="replay-turn__collapsed-label">Hidden from preview + export</span>
                        <p className="replay-turn__collapsed-text">{turn.previewText ?? turn.summary}</p>
                      </div>
                    ) : (
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
                    )}
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

function formatPreviewRoleLabel(role: PreviewTurnRole): string {
  return `${role}:`.toUpperCase()
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
    if (segment.block.type !== 'thinking' && !(segment.block.type === 'meta' && segment.block.appearance === 'disclosure')) {
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

function ReplayInlineBlock({ block }: { block: ReplayRenderableTextBlock }) {
  return (
    <div className={`replay-inline-block replay-inline-block--${block.type}`}>
      {block.type !== 'meta' && block.title ? <div className="replay-inline-block__title">{block.title}</div> : null}
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
  block: ReplayRenderableBlock
  isOpen: boolean
  onToggle: () => void
}) {
  const summaryMeta = getReplayBlockSummaryMeta(block)
  const contentClassName =
    block.type === 'tool'
      ? 'replay-disclosure__content replay-disclosure__content--tool'
      : block.type === 'meta'
        ? 'replay-disclosure__content replay-disclosure__content--meta'
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
