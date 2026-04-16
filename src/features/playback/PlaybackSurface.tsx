import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from '../../lib/replay/transcript-layout'
import type { PreparedTranscriptLayout } from '../../lib/replay/transcript-layout-types'
import type { PreviewTurn, ReplaySession } from '../preview/ReplayPanel'
import { ReplayTurnRow, type ReplayTurnPlaybackState } from '../preview/ReplayTurnRow'
import { ROW_GAP_PX, useVirtualTranscript } from '../preview/useVirtualTranscript'
import { usePlaybackViewport } from './usePlaybackViewport'

export interface PlaybackSurfaceProps {
  session: ReplaySession
  layout: PreparedTranscriptLayout
  onExitPlayback: () => void
}

type PlaybackMode = 'playing' | 'paused'

function PlaybackSurface({ session, layout, onExitPlayback }: PlaybackSurfaceProps) {
  const [expandedBlockIds, setExpandedBlockIds] = useState<Set<string>>(() => collectDefaultOpenIds(layout))
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('playing')
  const [playbackSpeedIndex, setPlaybackSpeedIndex] = useState(() => {
    const defaultIndex = PLAYBACK_SPEEDS.indexOf(DEFAULT_PLAYBACK_SPEED)
    return defaultIndex >= 0 ? defaultIndex : 0
  })
  const [playbackTurnIndex, setPlaybackTurnIndex] = useState(0)
  const [revealedUnitIds, setRevealedUnitIds] = useState<Set<string>>(new Set())
  const {
    checkOverflow,
    contentNodeRef,
    isAutoFollowing,
    markUserScrollIntent,
    onContentScroll,
    resetViewport,
    setContentNode: setViewportContentNode,
    viewportState,
    withProgrammaticScroll,
  } = usePlaybackViewport()
  const turnRefs = useRef<Record<string, HTMLLIElement | null>>({})

  const playbackTurns = useMemo(
    () => {
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

  const playbackComplete =
    playbackTurns.length > 0
    && playbackTurnIndex >= playbackTurns.length - 1
    && playbackTurns.every((turn) => turn.units.every((unit) => revealedUnitIds.has(unit.id)))

  const playbackCanStepBackward = playbackTurns.length > 0 && Boolean(
    playbackTurnIndex > 0 || activePlaybackTurn?.units.some((unit) => revealedUnitIds.has(unit.id)),
  )

  const displayedTurns = useMemo(() => {
    return session.turns.filter((turn) => {
      if (turn.isHidden) {
        return false
      }

      const playbackIndex = playbackTurnIndexById.get(turn.id)
      if (playbackIndex === undefined || playbackIndex > playbackTurnIndex) {
        return false
      }

      return true
    })
  }, [session.turns, playbackTurnIndex, playbackTurnIndexById])

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

  // Playback reveals rows incrementally, so windowing causes visible scroll
  // wobble as row heights and anchors keep changing under the viewport.
  const virtualizationEnabled = false
  const virtualTranscript = useVirtualTranscript({
    turnLayouts: displayedTurnLayouts,
    visibleTurnIds: null,
    activeTurnIndex: activeDisplayedTurnIndex,
    enabled: virtualizationEnabled,
    preserveActiveTurnAnchor: isAutoFollowing,
  })
  const {
    containerRef: virtualContainerRef,
    invalidate: invalidateVirtualTranscript,
    reportRowHeight,
    rowHeights,
    totalHeight,
    visibleRange,
  } = virtualTranscript

  const rowOffsets = useMemo(() => {
    const offsets: number[] = []
    let top = 0

    for (const row of rowHeights) {
      offsets.push(top)
      top += row.height
    }

    return offsets
  }, [rowHeights])

  const setContentNode = useCallback((node: HTMLDivElement | null) => {
    setViewportContentNode(node)
    virtualContainerRef(node)
  }, [setViewportContentNode, virtualContainerRef])

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
    invalidateVirtualTranscript()
  }, [invalidateVirtualTranscript])

  const resetPlayback = useCallback(() => {
    resetViewport()
    setPlaybackTurnIndex(0)
    setRevealedUnitIds(new Set())
  }, [resetViewport])

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

  // Playback timer
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

  // Re-check overflow when displayed content changes
  useEffect(() => {
    checkOverflow()
  }, [displayedTurns, revealedUnitIds, checkOverflow])

  // Auto-follow: keep active turn in view
  useEffect(() => {
    if (!isAutoFollowing || viewportState === 'underflow-bottom-anchored') {
      return
    }

    const currentTurnId = playbackTurns[playbackTurnIndex]?.turnId
    if (!currentTurnId) {
      return
    }

    const content = contentNodeRef.current

    const animationFrame = window.requestAnimationFrame(() => {
      const activeTurnNode = turnRefs.current[currentTurnId] ?? null
      const activeBottom = activeTurnNode
        ? activeTurnNode.offsetTop + activeTurnNode.offsetHeight
        : activeDisplayedTurnIndex >= 0
          ? (rowOffsets[activeDisplayedTurnIndex] ?? 0) + (rowHeights[activeDisplayedTurnIndex]?.height ?? 0)
          : null

      if (content && activeBottom !== null && typeof content.scrollTo === 'function') {
        const nextTop = Math.max(0, activeBottom - Math.max(0, content.clientHeight - 160))
        withProgrammaticScroll(() => {
          content.scrollTo({
            behavior: 'auto',
            top: nextTop,
          })
        })
      }
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    activeDisplayedTurnIndex,
    isAutoFollowing,
    viewportState,
    playbackTurnIndex,
    playbackTurns,
    revealedUnitIds,
    rowOffsets,
    rowHeights,
    contentNodeRef,
    withProgrammaticScroll,
  ])

  const renderedTurnRange = virtualizationEnabled
    ? displayedTurns.slice(visibleRange.startIndex, visibleRange.endIndex + 1)
    : displayedTurns

  return (
    <section
      className="preview-block"
      aria-live="polite"
    >
      <div
        ref={setContentNode}
        className="preview-block__content preview-block__content--chat"
        onScroll={onContentScroll}
        onPointerDown={markUserScrollIntent}
        onTouchStart={markUserScrollIntent}
        onWheel={markUserScrollIntent}
      >
        <header className="preview-block__header">
          <div className="preview-block__title-group">
            <h2>Session playback</h2>
            <p className="preview-block__details">{formatTurnCount(session.turnCount)}</p>
          </div>
        </header>

        <div
          className="preview-block__stage"
          data-viewport-state={viewportState}
        >
          <ul
            className={[
              'preview-block__transcript',
              virtualizationEnabled ? 'preview-block__transcript--virtual' : '',
            ].filter(Boolean).join(' ')}
            style={virtualizationEnabled ? { height: totalHeight, position: 'relative' } : undefined}
          >
            {renderedTurnRange.map((turn, sliceIndex) => {
              const rowIndex = virtualizationEnabled
                ? visibleRange.startIndex + sliceIndex
                : sliceIndex
              const playback = getTurnPlaybackState({
                activePlaybackUnitId,
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
                  mode="playback"
                  playback={playback}
                  style={virtualizationEnabled ? {
                    left: 0,
                    position: 'absolute',
                    right: 0,
                    top: rowOffsets[rowIndex] ?? 0,
                  } : undefined}
                  onToggleBlock={toggleBlock}
                  onMeasure={virtualizationEnabled ? (height) => {
                    reportRowHeight(rowIndex, height + ROW_GAP_PX)
                  } : undefined}
                  onTurnNode={(turnId, node) => {
                    turnRefs.current[turnId] = node
                  }}
                />
              )
            })}
          </ul>
        </div>
      </div>
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

            if (playbackComplete) {
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

            if (playbackComplete) {
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
        <button
          aria-label="Exit playback"
          className="preview-block__action"
          type="button"
          onClick={onExitPlayback}
        >
          <X size={14} strokeWidth={1.8} />
          Exit
        </button>
      </div>
    </section>
  )
}

function formatTurnCount(value: number): string {
  return `${value} ${value === 1 ? 'turn' : 'turns'}`
}

function getRequiredTurnLayout(
  layout: PreparedTranscriptLayout,
  turnId: string,
) {
  const turnLayout = layout.turnLayoutById.get(turnId)
  if (!turnLayout) {
    throw new Error(`Missing prepared transcript layout for turn ${turnId}`)
  }

  return turnLayout
}

function getTurnPlaybackState({
  activePlaybackUnitId,
  playbackTurnIndex,
  playbackTurnIndexById,
  playbackTurns,
  revealedUnitIds,
  turn,
}: {
  activePlaybackUnitId: string | null
  playbackTurnIndex: number
  playbackTurnIndexById: ReadonlyMap<string, number>
  playbackTurns: ReturnType<typeof createPlaybackTurnsFromLayout>
  revealedUnitIds: ReadonlySet<string>
  turn: PreviewTurn
}): ReplayTurnPlaybackState | undefined {
  const playbackIndex = playbackTurnIndexById.get(turn.id)
  if (playbackIndex === undefined) {
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

export { PlaybackSurface }
