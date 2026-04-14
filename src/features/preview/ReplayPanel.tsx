import {
  Bookmark,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  EyeOff,
  MessageSquare,
  Pause,
  Play,
  Settings2,
  Sparkles,
  Wrench,
  UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  createReplayPlaybackTurns,
  DEFAULT_PLAYBACK_SPEED,
  getActivePlaybackUnitId,
  getNextPlaybackDelay,
  getNextPlaybackState,
  getPreviousPlaybackState,
  PLAYBACK_SPEEDS,
} from '../../lib/replay/playback'
import type { ReplayRole } from '../../lib/api/contracts'

export type PreviewTurnRole = ReplayRole

/** Playback-ready turn shape used by the editor preview panel. */
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

/** Session payload rendered inside the playback transcript panel. */
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

/** Toolbar actions plus replay data needed by the playback transcript view. */
export type ReplayPanelProps = {
  canExport?: boolean
  isExporting?: boolean
  onExport?: () => void
  session: ReplaySession | null
  visibleCount: number
  totalCount: number
  onBookmarkChange?: (turnId: string, nextLabel: string) => void
  onOpenExportSettings?: () => void
  onOpenPreview?: () => void
  onToggleTurnIncluded?: (turnId: string) => void
}

const roleIconMap: Record<PreviewTurn['role'], typeof MessageSquare> = {
  user: UserRound,
  assistant: Bot,
  system: Sparkles,
  tool: Wrench,
}

type PlaybackMode = 'idle' | 'paused' | 'playing'

function ReplayPanel({
  canExport,
  isExporting,
  onExport,
  session,
  visibleCount,
  totalCount,
  onBookmarkChange,
  onOpenExportSettings,
  onOpenPreview,
  onToggleTurnIncluded,
}: ReplayPanelProps) {
  const [expandedBlockIds, setExpandedBlockIds] = useState<Set<string>>(new Set())
  const [editingNoteTurnId, setEditingNoteTurnId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('idle')
  const [playbackSpeedIndex, setPlaybackSpeedIndex] = useState(() => {
    const defaultIndex = PLAYBACK_SPEEDS.indexOf(DEFAULT_PLAYBACK_SPEED)
    return defaultIndex >= 0 ? defaultIndex : 0
  })
  const [playbackTurnIndex, setPlaybackTurnIndex] = useState(0)
  const [revealedUnitIds, setRevealedUnitIds] = useState<Set<string>>(new Set())
  const contentRef = useRef<HTMLDivElement | null>(null)
  const turnRefs = useRef<Record<string, HTMLLIElement | null>>({})

  useEffect(() => {
    if (!session) {
      setExpandedBlockIds(new Set())
      setEditingNoteTurnId(null)
      setNoteDraft('')
      setPlaybackMode('idle')
      setPlaybackTurnIndex(0)
      setRevealedUnitIds(new Set())
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

  const playbackTurns = useMemo(
    // Hidden turns stay editable in full session list, but playback pacing only
    // tracks visible turns. This separate map bridges session order to playback order.
    () => createReplayPlaybackTurns(session?.turns.filter((turn) => !turn.isHidden) ?? []),
    [session],
  )
  const playbackTurnIndexById = useMemo(
    () => new Map(playbackTurns.map((turn, index) => [turn.turnId, index])),
    [playbackTurns],
  )
  const playbackSpeed = PLAYBACK_SPEEDS[playbackSpeedIndex] ?? DEFAULT_PLAYBACK_SPEED
  const activePlaybackTurn = playbackTurns[playbackTurnIndex]
  const activePlaybackUnitId = useMemo(
    () => getActivePlaybackUnitId(activePlaybackTurn, revealedUnitIds),
    [activePlaybackTurn, revealedUnitIds],
  )
  const playbackStarted = playbackMode !== 'idle'
  const playbackComplete =
    playbackTurns.length > 0
    && playbackTurnIndex >= playbackTurns.length - 1
    && playbackTurns.every((turn) => turn.units.every((unit) => revealedUnitIds.has(unit.id)))
  const playbackCanStepBackward = playbackTurns.length > 0 && Boolean(
    playbackTurnIndex > 0 || activePlaybackTurn?.units.some((unit) => revealedUnitIds.has(unit.id)),
  )

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

    // Note edits commit on blur/Enter so hover-driven controls stay lightweight.
    onBookmarkChange(editingNoteTurnId, noteDraft)
    closeNoteEditor()
  }

  const resetPlayback = () => {
    setPlaybackTurnIndex(0)
    setRevealedUnitIds(new Set())
  }

  const stepPlaybackForward = () => {
    const nextState = getNextPlaybackState(playbackTurns, playbackTurnIndex, revealedUnitIds)
    if (!nextState) {
      setPlaybackMode('paused')
      return
    }

    setPlaybackTurnIndex(nextState.turnIndex)
    setRevealedUnitIds(nextState.revealedUnitIds)
  }

  const stepPlaybackBackward = () => {
    const previousState = getPreviousPlaybackState(playbackTurns, playbackTurnIndex, revealedUnitIds)
    if (!previousState) {
      resetPlayback()
      return
    }

    setPlaybackTurnIndex(previousState.turnIndex)
    setRevealedUnitIds(previousState.revealedUnitIds)
  }

  useEffect(() => {
    if (playbackMode !== 'playing') {
      return
    }

    const delayMs = getNextPlaybackDelay(playbackTurns, playbackTurnIndex, revealedUnitIds, playbackSpeed)
    if (delayMs === null) {
      setPlaybackMode('paused')
      return
    }

    const timer = window.setTimeout(() => {
      stepPlaybackForward()
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [playbackMode, playbackSpeed, playbackTurnIndex, playbackTurns, revealedUnitIds])

  useEffect(() => {
    const content = contentRef.current
    if (!content || !session) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (typeof content.scrollTo === 'function') {
        content.scrollTo({
          behavior: playbackMode === 'playing' ? 'smooth' : 'auto',
          top: content.scrollHeight,
        })
        return
      }

      content.scrollTop = content.scrollHeight
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [activePlaybackUnitId, playbackMode, playbackStarted, playbackTurnIndex, revealedUnitIds, session?.id])

  useEffect(() => {
    if (!playbackStarted) {
      return
    }

    const currentTurnId = playbackTurns[playbackTurnIndex]?.turnId
    if (!currentTurnId) {
      return
    }

    const target = turnRefs.current[currentTurnId]
    if (!target) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (typeof target.scrollIntoView !== 'function') {
        return
      }

      target.scrollIntoView({
        behavior: playbackMode === 'playing' ? 'smooth' : 'auto',
        block: 'end',
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [activePlaybackUnitId, playbackMode, playbackStarted, playbackTurnIndex, playbackTurns])

  return (
    <section className="preview-block" aria-live="polite">
      <div
        ref={contentRef}
        className={`preview-block__content preview-block__content--chat${session ? '' : ' preview-block__content--idle'}`}
      >
        <header className="preview-block__header">
          <div className="preview-block__title-group">
            <h2>{session ? 'Session playback' : 'Preview ready'}</h2>
            {session ? <p className="preview-block__details">{formatTurnCount(totalCount)}</p> : null}
          </div>
          {session ? (
            <div className="preview-block__meta">
              <div className="preview-block__count">
                <Clock size={14} strokeWidth={1.8} />
                {visibleCount}/{totalCount} visible
              </div>
            </div>
          ) : null}
        </header>

        <div className={`preview-block__stage${session ? '' : ' preview-block__stage--idle'}`}>
          {!session ? (
            <div className="preview-block__empty" role="status">
              <h3>Choose a session from the library</h3>
              <p className="preview-block__hint">
                Open any conversation in the browser rail to inspect tool calls, thinking blocks, and timeline turns.
              </p>
            </div>
          ) : (
            <ul className="preview-block__transcript">
              {session.turns.map((turn) => {
                if (playbackStarted && turn.isHidden) {
                  return null
                }

              const playbackIndex = playbackTurnIndexById.get(turn.id)
              if (playbackStarted && playbackIndex !== undefined && playbackIndex > playbackTurnIndex) {
                return null
              }

               const Icon = roleIconMap[turn.role]
               const turnTone = getReplayTurnTone(turn)
               const isPlaybackPast = playbackStarted && playbackIndex !== undefined && playbackIndex < playbackTurnIndex
               const isPlaybackActive = playbackStarted && playbackIndex === playbackTurnIndex
               const playbackTurn = playbackIndex === undefined ? undefined : playbackTurns[playbackIndex]
               // Past turns reveal everything, future turns reveal nothing, active
               // user turns reveal instantly, active assistant/tool turns reveal unit-by-unit.
               const turnVisibleUnitIds =
                 !playbackStarted || playbackTurn === undefined || isPlaybackPast || (isPlaybackActive && turn.role === 'user')
                   ? new Set(playbackTurn?.units.map((unit) => unit.id) ?? [])
                  : isPlaybackActive
                    ? revealedUnitIds
                    : new Set<string>()

                return (
                  <li
                    key={turn.id}
                    ref={(node) => {
                      turnRefs.current[turn.id] = node
                    }}
                    className={[
                      'replay-turn',
                      `replay-turn--${turnTone}`,
                      turn.isHidden ? 'is-hidden' : '',
                      isPlaybackPast ? 'is-playback-past' : '',
                      isPlaybackActive ? 'is-playback-active' : '',
                    ].filter(Boolean).join(' ')}
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
                              playback={
                                playbackStarted && playbackIndex !== undefined
                                  ? {
                                      activeUnitId: isPlaybackActive ? activePlaybackUnitId : null,
                                      animate: isPlaybackActive,
                                      revealAll: isPlaybackPast || (isPlaybackActive && turn.role === 'user'),
                                      visibleUnitIds: turnVisibleUnitIds,
                                    }
                                  : undefined
                              }
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
      </div>
      {session ? (
        <div className="preview-block__dock" role="toolbar" aria-label="Playback controls">
          <button
            aria-label={playbackMode === 'playing' ? 'Pause playback' : 'Play transcript'}
            className={`preview-block__action preview-block__action--icon ${playbackMode === 'playing' ? 'preview-block__action--active' : ''}`}
            type="button"
            onClick={() => {
              if (playbackMode === 'playing') {
                setPlaybackMode('paused')
                return
              }

              if (playbackTurns.length === 0) {
                return
              }

              if (playbackMode === 'idle' || playbackComplete) {
                resetPlayback()
              }

              setPlaybackMode('playing')
            }}
          >
            {playbackMode === 'playing' ? <Pause size={16} strokeWidth={1.8} /> : <Play size={16} strokeWidth={1.8} />}
          </button>
          <button
            aria-label="Previous step"
            className="preview-block__action preview-block__action--icon"
            type="button"
            disabled={!playbackCanStepBackward}
            onClick={() => {
              if (!playbackCanStepBackward) {
                return
              }

              if (!playbackStarted) {
                resetPlayback()
                setPlaybackMode('paused')
                return
              }

              setPlaybackMode('paused')
              stepPlaybackBackward()
            }}
          >
            <ChevronLeft size={16} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Next step"
            className="preview-block__action preview-block__action--icon"
            type="button"
            disabled={playbackTurns.length === 0}
            onClick={() => {
              if (playbackTurns.length === 0) {
                return
              }

              setPlaybackMode('paused')

              if (!playbackStarted || playbackComplete) {
                resetPlayback()
                return
              }

              stepPlaybackForward()
            }}
          >
            <ChevronRight size={16} strokeWidth={1.8} />
          </button>
          <button
            aria-label={`Playback speed ${playbackSpeed}x`}
            className="preview-block__action preview-block__action--speed"
            type="button"
            onClick={() => setPlaybackSpeedIndex((current) => (current + 1) % PLAYBACK_SPEEDS.length)}
          >
            {playbackSpeed}x
          </button>
          <button className="preview-block__action" type="button" onClick={onOpenPreview}>
            <Eye size={14} strokeWidth={1.8} />
            Preview
          </button>
          <button
            className="preview-block__action preview-block__action--primary"
            type="button"
            disabled={!canExport || isExporting}
            onClick={onExport}
          >
            <Download size={14} strokeWidth={1.8} />
            {isExporting ? 'Exporting…' : 'Export'}
          </button>
          <button
            aria-label="Open export settings"
            className="preview-block__action preview-block__action--icon"
            type="button"
            onClick={onOpenExportSettings}
          >
            <Settings2 size={16} strokeWidth={1.8} />
          </button>
        </div>
      ) : null}
    </section>
  )
}

function formatTurnCount(value: number): string {
  return `${value} ${value === 1 ? 'turn' : 'turns'}`
}

function formatPreviewRoleLabel(role: PreviewTurnRole): string {
  return `${role}:`.toUpperCase()
}

function ReplaySegmentDisclosure({
  expandedBlockIds,
  playback,
  onToggle,
  segment,
}: {
  expandedBlockIds: ReadonlySet<string>
  playback?: {
    activeUnitId: string | null
    animate: boolean
    revealAll: boolean
    visibleUnitIds: ReadonlySet<string>
  }
  onToggle: (id: string) => void
  segment: ReplaySegment
}) {
  if (segment.type === 'block') {
    if (segment.block.type !== 'thinking' && !(segment.block.type === 'meta' && segment.block.appearance === 'disclosure')) {
      return (
        <ReplayPlaybackUnit playback={playback} unitId={segment.block.id}>
          <ReplayInlineBlock block={segment.block} />
        </ReplayPlaybackUnit>
      )
    }

    return (
      <ReplayPlaybackUnit playback={playback} unitId={segment.block.id}>
        <ReplayBlockDisclosure
          block={segment.block}
          isOpen={expandedBlockIds.has(segment.block.id)}
          onToggle={() => onToggle(segment.block.id)}
        />
      </ReplayPlaybackUnit>
    )
  }

  if (!shouldGroupReplayToolRun(segment)) {
    return (
      <div className="replay-tool-run">
        {segment.blocks.map((block) => (
          <ReplayPlaybackUnit key={block.id} playback={playback} unitId={block.id}>
            <ReplayBlockDisclosure
              block={block}
              isOpen={expandedBlockIds.has(block.id)}
              onToggle={() => onToggle(block.id)}
            />
          </ReplayPlaybackUnit>
        ))}
      </div>
    )
  }

  const isOpen = expandedBlockIds.has(segment.id)
  const visibleBlocks = getVisibleReplayToolRunBlocks(segment, playback)
  if (visibleBlocks.length === 0) {
    return null
  }

  const visibleSegment =
    visibleBlocks.length === segment.blocks.length
      ? segment
      : {
          ...segment,
          blocks: visibleBlocks,
        }
  const summaryMeta = getReplayToolRunSummaryMeta(visibleSegment)

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
        <span className="replay-tool-group__label">{getReplayToolRunLabel(visibleSegment)}</span>
        {summaryMeta ? <span className="replay-tool-group__meta">{summaryMeta}</span> : null}
      </summary>
      <div className="replay-tool-group__content">
        {visibleBlocks.map((block) => (
          <ReplayPlaybackUnit key={block.id} playback={playback} unitId={block.id}>
            <ReplayBlockDisclosure
              block={block}
              isOpen={expandedBlockIds.has(block.id)}
              onToggle={() => onToggle(block.id)}
            />
          </ReplayPlaybackUnit>
        ))}
      </div>
    </details>
  )
}

function ReplayPlaybackUnit({
  children,
  playback,
  unitId,
}: {
  children: React.ReactNode
  playback?: {
    activeUnitId: string | null
    animate: boolean
    revealAll: boolean
    visibleUnitIds: ReadonlySet<string>
  }
  unitId: string
}) {
  if (playback && !playback.revealAll && !playback.visibleUnitIds.has(unitId)) {
    return null
  }

  const isActive = playback?.activeUnitId === unitId
  const shouldAnimate = Boolean(playback?.animate && playback && playback.visibleUnitIds.has(unitId))

  return (
    <div
      className={[
        'replay-playback-unit',
        shouldAnimate ? 'is-revealed' : '',
        isActive ? 'is-active' : '',
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
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

function getVisibleReplayToolRunBlocks(
  segment: Extract<ReplaySegment, { type: 'tool-run' }>,
  playback:
    | {
        activeUnitId: string | null
        animate: boolean
        revealAll: boolean
        visibleUnitIds: ReadonlySet<string>
      }
    | undefined,
) {
  if (!playback || playback.revealAll) {
    return segment.blocks
  }

  return segment.blocks.filter((block) => playback.visibleUnitIds.has(block.id))
}

export { ReplayPanel }
