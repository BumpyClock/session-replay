import { Clock, Download, Eye, Pause, Play, Settings2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayBlock, ReplayRole } from '../../lib/api/contracts'
import {
  DEFAULT_PLAYBACK_SPEED,
  getActivePlaybackUnitId,
  getNextPlaybackDelay,
  getNextPlaybackState,
  getPreviousPlaybackState,
  PLAYBACK_SPEEDS,
} from '../../lib/replay/playback'
import {
  collectDefaultOpenIds,
  createPlaybackTurnsFromLayout,
  prepareTranscriptLayout,
} from '../../lib/replay/transcript-layout'
import type { PreparedTranscriptLayout } from '../../lib/replay/transcript-layout-types'
import { ReplayTurnRow, type ReplayTurnPlaybackState } from './ReplayTurnRow'
import { ROW_GAP_PX, useVirtualTranscript, VIRTUALIZATION_THRESHOLD } from './useVirtualTranscript'

export type PreviewTurnRole = ReplayRole

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
  canExport?: boolean
  isExporting?: boolean
  layout?: PreparedTranscriptLayout | null
  onExport?: () => void
  session: ReplaySession | null
  visibleCount: number
  totalCount: number
  onBookmarkChange?: (turnId: string, nextLabel: string) => void
  onOpenExportSettings?: () => void
  onOpenPreview?: () => void
  onToggleTurnIncluded?: (turnId: string) => void
}

type PlaybackMode = 'idle' | 'paused' | 'playing'

function ReplayPanel({
  canExport,
  isExporting,
  layout: externalLayout,
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

  const layout = useMemo(
    () => externalLayout ?? (session ? prepareTranscriptLayout(session.turns) : null),
    [externalLayout, session],
  )

  useEffect(() => {
    if (!session || !layout) {
      setExpandedBlockIds(new Set())
      setEditingNoteTurnId(null)
      setNoteDraft('')
      setPlaybackMode('idle')
      setPlaybackTurnIndex(0)
      setRevealedUnitIds(new Set())
      return
    }

    setExpandedBlockIds(collectDefaultOpenIds(layout))
  }, [layout, session?.id])

  const playbackTurns = useMemo(
    () => {
      if (!session || !layout) {
        return []
      }

      const visibleTurns = session.turns.filter((turn) => !turn.isHidden)
      return createPlaybackTurnsFromLayout(visibleTurns, layout)
    },
    [session, layout],
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

  const displayedTurns = useMemo(() => {
    if (!session) {
      return []
    }

    return session.turns.filter((turn) => {
      if (playbackStarted && turn.isHidden) {
        return false
      }

      const playbackIndex = playbackTurnIndexById.get(turn.id)
      if (playbackStarted && playbackIndex !== undefined && playbackIndex > playbackTurnIndex) {
        return false
      }

      return true
    })
  }, [session, playbackStarted, playbackTurnIndex, playbackTurnIndexById])

  const displayedTurnLayouts = useMemo(
    () => displayedTurns.map((turn) => getRequiredTurnLayout(layout, turn.id)),
    [displayedTurns, layout],
  )
  const activeDisplayedTurnIndex = useMemo(() => {
    const activeTurnId = playbackTurns[playbackTurnIndex]?.turnId
    if (!activeTurnId) {
      return -1
    }

    return displayedTurns.findIndex((turn) => turn.id === activeTurnId)
  }, [displayedTurns, playbackTurnIndex, playbackTurns])
  const virtualizationEnabled = Boolean(session && displayedTurns.length >= VIRTUALIZATION_THRESHOLD)
  const virtualTranscript = useVirtualTranscript({
    turnLayouts: displayedTurnLayouts,
    visibleTurnIds: null,
    activeTurnIndex: activeDisplayedTurnIndex,
    enabled: virtualizationEnabled,
  })
  const rowOffsets = useMemo(() => {
    const offsets: number[] = []
    let top = 0

    for (const row of virtualTranscript.rowHeights) {
      offsets.push(top)
      top += row.height
    }

    return offsets
  }, [virtualTranscript.rowHeights])

  const setContentNode = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    virtualTranscript.containerRef(node)
  }, [virtualTranscript.containerRef])

  const toggleBlock = useCallback((blockId: string) => {
    setExpandedBlockIds((current) => {
      const next = new Set(current)
      if (next.has(blockId)) {
        next.delete(blockId)
      } else {
        next.add(blockId)
      }
      return next
    })
    virtualTranscript.invalidate()
  }, [virtualTranscript])

  const openNoteEditor = useCallback((turn: PreviewTurn) => {
    setEditingNoteTurnId(turn.id)
    setNoteDraft(turn.bookmarkLabel ?? '')
  }, [])

  const closeNoteEditor = useCallback(() => {
    setEditingNoteTurnId(null)
    setNoteDraft('')
  }, [])

  const commitNoteEditor = useCallback(() => {
    if (!editingNoteTurnId || !onBookmarkChange) {
      closeNoteEditor()
      return
    }

    onBookmarkChange(editingNoteTurnId, noteDraft)
    closeNoteEditor()
  }, [closeNoteEditor, editingNoteTurnId, noteDraft, onBookmarkChange])

  const resetPlayback = useCallback(() => {
    setPlaybackTurnIndex(0)
    setRevealedUnitIds(new Set())
  }, [])

  const stepPlaybackForward = useCallback(() => {
    const nextState = getNextPlaybackState(playbackTurns, playbackTurnIndex, revealedUnitIds)
    if (!nextState) {
      setPlaybackMode('paused')
      return
    }

    setPlaybackTurnIndex(nextState.turnIndex)
    setRevealedUnitIds(nextState.revealedUnitIds)
  }, [playbackTurnIndex, playbackTurns, revealedUnitIds])

  const stepPlaybackBackward = useCallback(() => {
    const previousState = getPreviousPlaybackState(playbackTurns, playbackTurnIndex, revealedUnitIds)
    if (!previousState) {
      resetPlayback()
      return
    }

    setPlaybackTurnIndex(previousState.turnIndex)
    setRevealedUnitIds(previousState.revealedUnitIds)
  }, [playbackTurnIndex, playbackTurns, resetPlayback, revealedUnitIds])

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
  }, [playbackMode, playbackSpeed, playbackTurnIndex, playbackTurns, revealedUnitIds, stepPlaybackForward])

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
    const activeOffset = activeDisplayedTurnIndex >= 0 ? rowOffsets[activeDisplayedTurnIndex] : null
    const content = contentRef.current

    const animationFrame = window.requestAnimationFrame(() => {
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({
          behavior: playbackMode === 'playing' ? 'smooth' : 'auto',
          block: 'end',
        })
        return
      }

      if (content && activeOffset !== null && typeof content.scrollTo === 'function') {
        const nextTop = Math.max(0, activeOffset - Math.max(0, content.clientHeight - 160))
        content.scrollTo({
          behavior: playbackMode === 'playing' ? 'smooth' : 'auto',
          top: nextTop,
        })
      }
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    activeDisplayedTurnIndex,
    activePlaybackUnitId,
    playbackMode,
    playbackStarted,
    playbackTurnIndex,
    playbackTurns,
    rowOffsets,
  ])

  const renderedTurnRange = virtualizationEnabled
    ? displayedTurns.slice(virtualTranscript.visibleRange.startIndex, virtualTranscript.visibleRange.endIndex + 1)
    : displayedTurns

  return (
    <section className="preview-block" aria-live="polite">
      <div
        ref={setContentNode}
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
            <ul
              className={`preview-block__transcript${virtualizationEnabled ? ' preview-block__transcript--virtual' : ''}`}
              style={virtualizationEnabled ? { height: virtualTranscript.totalHeight, position: 'relative' } : undefined}
            >
              {renderedTurnRange.map((turn, sliceIndex) => {
                const rowIndex = virtualizationEnabled
                  ? virtualTranscript.visibleRange.startIndex + sliceIndex
                  : sliceIndex
                const playback = getTurnPlaybackState({
                  activePlaybackUnitId,
                  playbackStarted,
                  playbackTurnIndex,
                  playbackTurnIndexById,
                  playbackTurns,
                  revealedUnitIds,
                  turn,
                })

                return (
                  <ReplayTurnRow
                    key={turn.id}
                    turn={turn}
                    turnLayout={displayedTurnLayouts[rowIndex]}
                    expandedBlockIds={expandedBlockIds}
                    editingNoteTurnId={editingNoteTurnId}
                    noteDraft={noteDraft}
                    playback={playback}
                    style={virtualizationEnabled ? {
                      left: 0,
                      position: 'absolute',
                      right: 0,
                      top: rowOffsets[rowIndex] ?? 0,
                    } : undefined}
                    onBookmarkDraftChange={setNoteDraft}
                    onBookmarkSubmit={commitNoteEditor}
                    onBookmarkCancel={closeNoteEditor}
                    onOpenBookmark={openNoteEditor}
                    onToggleBlock={toggleBlock}
                    onToggleTurnIncluded={onToggleTurnIncluded}
                    onMeasure={virtualizationEnabled ? (height) => {
                      virtualTranscript.reportRowHeight(rowIndex, height + ROW_GAP_PX)
                    } : undefined}
                    onTurnNode={(turnId, node) => {
                      turnRefs.current[turnId] = node
                    }}
                  />
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

function getRequiredTurnLayout(
  layout: PreparedTranscriptLayout | null,
  turnId: string,
) {
  const turnLayout = layout?.turnLayoutById.get(turnId)
  if (!turnLayout) {
    throw new Error(`Missing prepared transcript layout for turn ${turnId}`)
  }

  return turnLayout
}

function getTurnPlaybackState({
  activePlaybackUnitId,
  playbackStarted,
  playbackTurnIndex,
  playbackTurnIndexById,
  playbackTurns,
  revealedUnitIds,
  turn,
}: {
  activePlaybackUnitId: string | null
  playbackStarted: boolean
  playbackTurnIndex: number
  playbackTurnIndexById: ReadonlyMap<string, number>
  playbackTurns: ReturnType<typeof createPlaybackTurnsFromLayout>
  revealedUnitIds: ReadonlySet<string>
  turn: PreviewTurn
}): ReplayTurnPlaybackState | undefined {
  const playbackIndex = playbackTurnIndexById.get(turn.id)
  if (!playbackStarted || playbackIndex === undefined) {
    return undefined
  }

  const playbackTurn = playbackTurns[playbackIndex]
  const isPast = playbackIndex < playbackTurnIndex
  const isActive = playbackIndex === playbackTurnIndex
  const revealAll = isPast || (isActive && turn.role === 'user')
  const visibleUnitIds = revealAll
    ? new Set(playbackTurn?.units.map((unit) => unit.id) ?? [])
    : isActive
      ? revealedUnitIds
      : new Set<string>()

  return {
    activeUnitId: isActive ? activePlaybackUnitId : null,
    animate: isActive,
    isActive,
    isPast,
    revealAll,
    visibleUnitIds,
  }
}

export { ReplayPanel }
