import { Clock, Download, Eye, Play, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayBlock, ReplayRole } from '../../lib/api/contracts'
import {
  collectDefaultOpenIds,
  prepareTranscriptLayout,
} from '../../lib/replay/transcript-layout'
import type { PreparedTranscriptLayout } from '../../lib/replay/transcript-layout-types'
import { ReplayTurnRow } from './ReplayTurnRow'
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
  onStartPlayback?: () => void
  onToggleTurnIncluded?: (turnId: string) => void
}

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
  onStartPlayback,
  onToggleTurnIncluded,
}: ReplayPanelProps) {
  const sessionId = session?.id ?? null
  const [expandedBlockIds, setExpandedBlockIds] = useState<Set<string>>(new Set())
  const [editingNoteTurnId, setEditingNoteTurnId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const turnRefs = useRef<Record<string, HTMLLIElement | null>>({})

  const layout = useMemo(
    () => externalLayout ?? (session ? prepareTranscriptLayout(session.turns) : null),
    [externalLayout, session],
  )

  useEffect(() => {
    if (!sessionId || !layout) {
      setExpandedBlockIds(new Set())
      setEditingNoteTurnId(null)
      setNoteDraft('')
      return
    }

    setExpandedBlockIds(collectDefaultOpenIds(layout))
  }, [layout, sessionId])

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

    return session.turns
  }, [session])

  const displayedTurnLayouts = useMemo(
    () => displayedTurns.map((turn) => getRequiredTurnLayout(layout, turn.id)),
    [displayedTurns, layout],
  )
  const virtualizationEnabled = Boolean(session && displayedTurns.length >= VIRTUALIZATION_THRESHOLD)
  const virtualTranscript = useVirtualTranscript({
    turnLayouts: displayedTurnLayouts,
    visibleTurnIds: null,
    activeTurnIndex: -1,
    enabled: virtualizationEnabled,
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
    contentRef.current = node
    virtualContainerRef(node)
  }, [virtualContainerRef])

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

  useEffect(() => {
    const content = contentRef.current
    if (!content || !sessionId) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      if (typeof content.scrollTo === 'function') {
        content.scrollTo({
          behavior: 'auto',
          top: 0,
        })
        return
      }

      content.scrollTop = 0
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
    }
  }, [sessionId])

  const renderedTurnRange = virtualizationEnabled
    ? displayedTurns.slice(visibleRange.startIndex, visibleRange.endIndex + 1)
    : displayedTurns

  return (
    <section className="preview-block" aria-live="polite">
      <div
        ref={setContentNode}
        className={`preview-block__content preview-block__content--chat${session ? '' : ' preview-block__content--idle'}`}
      >
        <header className="preview-block__header">
          <div className="preview-block__title-group">
            <h2>{session ? 'Session editor' : 'Preview ready'}</h2>
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
               style={virtualizationEnabled ? { height: totalHeight, position: 'relative' } : undefined}
             >
               {renderedTurnRange.map((turn, sliceIndex) => {
                 const rowIndex = virtualizationEnabled
                   ? visibleRange.startIndex + sliceIndex
                   : sliceIndex

                return (
                  <ReplayTurnRow
                    key={turn.id}
                    turn={turn}
                    turnLayout={displayedTurnLayouts[rowIndex]}
                    expandedBlockIds={expandedBlockIds}
                    editingNoteTurnId={editingNoteTurnId}
                    noteDraft={noteDraft}
                    mode="editor"
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
                       reportRowHeight(rowIndex, height + ROW_GAP_PX)
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
        <div className="preview-block__dock" role="toolbar" aria-label="Editor controls">
          {onStartPlayback ? (
            <button
              aria-label="Play transcript"
              className="preview-block__action preview-block__action--icon"
              type="button"
              onClick={onStartPlayback}
            >
              <Play size={16} strokeWidth={1.8} />
            </button>
          ) : null}
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

export { ReplayPanel }
