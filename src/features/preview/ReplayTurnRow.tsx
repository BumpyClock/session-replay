import { Bookmark, Bot, ChevronDown, Eye, EyeOff, Sparkles, UserRound, Wrench } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ReplayBlock, ReplayRole } from '../../lib/api/contracts'
import type { ReplayRenderableBlock, ReplayRenderableTextBlock } from '../../lib/replay/context-blocks'
import {
  getReplayToolRunLabel,
  getReplayToolRunSummaryMeta,
  type ReplaySegment,
} from '../../lib/replay/segments'
import { getVisibleToolRunBlocks } from '../../lib/replay/transcript-layout'
import type {
  PreparedBlockLayout,
  PreparedToolRunLayout,
  PreparedTurnLayout,
} from '../../lib/replay/transcript-layout-types'

type PreviewTurn = {
  blocks: ReplayBlock[]
  bookmarkLabel?: string
  id: string
  role: ReplayRole
  summary: string
  timestamp: string
  isHidden?: boolean
  isBookmarked?: boolean
  previewText?: string
  timeLabel: string
}

export interface ReplayTurnPlaybackState {
  activeUnitId: string | null
  animate: boolean
  isActive: boolean
  isPast: boolean
  revealAll: boolean
  visibleUnitIds: ReadonlySet<string>
}

export interface ReplayTurnRowProps {
  turn: PreviewTurn
  turnLayout: PreparedTurnLayout
  expandedBlockIds: ReadonlySet<string>
  editingNoteTurnId: string | null
  noteDraft: string
  playback?: ReplayTurnPlaybackState
  style?: CSSProperties
  onBookmarkDraftChange: (value: string) => void
  onBookmarkSubmit: () => void
  onBookmarkCancel: () => void
  onOpenBookmark: (turn: PreviewTurn) => void
  onToggleBlock: (id: string) => void
  onToggleTurnIncluded?: (turnId: string) => void
  onMeasure?: (height: number) => void
  onTurnNode?: (turnId: string, node: HTMLLIElement | null) => void
}

const roleIconMap = {
  assistant: Bot,
  system: Sparkles,
  tool: Wrench,
  user: UserRound,
} satisfies Record<ReplayRole, typeof Bot>

export function ReplayTurnRow({
  turn,
  turnLayout,
  expandedBlockIds,
  editingNoteTurnId,
  noteDraft,
  playback,
  style,
  onBookmarkDraftChange,
  onBookmarkSubmit,
  onBookmarkCancel,
  onOpenBookmark,
  onToggleBlock,
  onToggleTurnIncluded,
  onMeasure,
  onTurnNode,
}: ReplayTurnRowProps) {
  const rowRef = useRef<HTMLLIElement | null>(null)
  const Icon = roleIconMap[turn.role]
  const isEditingNote = editingNoteTurnId === turn.id

  useEffect(() => {
    const node = rowRef.current
    if (!node) {
      return
    }

    onTurnNode?.(turn.id, node)
    onMeasure?.(node.getBoundingClientRect().height)

    if (typeof ResizeObserver === 'undefined' || !onMeasure) {
      return () => onTurnNode?.(turn.id, null)
    }

    const observer = new ResizeObserver(() => {
      onMeasure(node.getBoundingClientRect().height)
    })
    observer.observe(node)

    return () => {
      observer.disconnect()
      onTurnNode?.(turn.id, null)
    }
  }, [onMeasure, onTurnNode, turn.id, turnLayout, expandedBlockIds, playback, isEditingNote, noteDraft])

  return (
    <li
      ref={rowRef}
      className={[
        'replay-turn',
        `replay-turn--${turnLayout.tone}`,
        turn.isHidden ? 'is-hidden' : '',
        playback?.isPast ? 'is-playback-past' : '',
        playback?.isActive ? 'is-playback-active' : '',
      ].filter(Boolean).join(' ')}
      style={style}
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
                onClick={() => onOpenBookmark(turn)}
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
          {isEditingNote ? (
            <div className="replay-turn__note-editor">
              <input
                aria-label={`Bookmark note for ${turn.id}`}
                autoFocus
                className="replay-turn__note-input"
                placeholder="Add note for export bookmark"
                value={noteDraft}
                onBlur={onBookmarkSubmit}
                onChange={(event) => onBookmarkDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onBookmarkSubmit()
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onBookmarkCancel()
                  }
                }}
              />
            </div>
          ) : turn.bookmarkLabel ? (
            <button
              className="replay-turn__note-pill"
              type="button"
              onClick={() => onOpenBookmark(turn)}
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
            {turnLayout.segments.map((segment) => (
              <ReplaySegmentDisclosure
                key={segment.id}
                blockHtml={turnLayout.blockHtml}
                blockMetaById={turnLayout.blockMetaById}
                expandedBlockIds={expandedBlockIds}
                playback={playback}
                segment={segment}
                toolRunMetaById={turnLayout.toolRunMetaById}
                onToggle={onToggleBlock}
              />
            ))}
          </div>
        )}
        {turn.isBookmarked ? <span className="replay-turn__bookmark">bookmarked</span> : null}
      </div>
    </li>
  )
}

function ReplaySegmentDisclosure({
  blockHtml,
  blockMetaById,
  expandedBlockIds,
  playback,
  onToggle,
  segment,
  toolRunMetaById,
}: {
  blockHtml: ReadonlyMap<string, string>
  blockMetaById: ReadonlyMap<string, PreparedBlockLayout>
  expandedBlockIds: ReadonlySet<string>
  playback?: ReplayTurnPlaybackState
  onToggle: (id: string) => void
  segment: ReplaySegment
  toolRunMetaById: ReadonlyMap<string, PreparedToolRunLayout>
}) {
  if (segment.type === 'block') {
    const blockMeta = getRequiredBlockLayout(blockMetaById, segment.block.id)
    if (!blockMeta.isDisclosure) {
      return (
        <ReplayPlaybackUnit playback={playback} unitId={segment.block.id}>
          <ReplayInlineBlock block={segment.block} html={blockHtml.get(segment.block.id) ?? ''} />
        </ReplayPlaybackUnit>
      )
    }

    return (
      <ReplayPlaybackUnit playback={playback} unitId={segment.block.id}>
        <ReplayBlockDisclosure
          block={segment.block}
          html={blockHtml.get(segment.block.id) ?? ''}
          meta={blockMeta}
          isOpen={expandedBlockIds.has(segment.block.id)}
          onToggle={() => onToggle(segment.block.id)}
        />
      </ReplayPlaybackUnit>
    )
  }

  const toolRunMeta = getRequiredToolRunLayout(toolRunMetaById, segment.id)
  if (!toolRunMeta.grouped) {
    return (
      <div className="replay-tool-run">
        {segment.blocks.map((block) => (
          <ReplayPlaybackUnit key={block.id} playback={playback} unitId={block.id}>
            <ReplayBlockDisclosure
              block={block}
              html={blockHtml.get(block.id) ?? ''}
              meta={getRequiredBlockLayout(blockMetaById, block.id)}
              isOpen={expandedBlockIds.has(block.id)}
              onToggle={() => onToggle(block.id)}
            />
          </ReplayPlaybackUnit>
        ))}
      </div>
    )
  }

  const visibleBlocks = playback && !playback.revealAll
    ? getVisibleToolRunBlocks(segment, playback.visibleUnitIds)
    : segment.blocks
  if (visibleBlocks.length === 0) {
    return null
  }

  const isOpen = expandedBlockIds.has(segment.id)
  const visibleSegment = visibleBlocks.length === segment.blocks.length
    ? segment
    : { ...segment, blocks: visibleBlocks }
  const label = visibleBlocks.length === segment.blocks.length
    ? toolRunMeta.label
    : getReplayToolRunLabel(visibleSegment)
  const summaryMeta = visibleBlocks.length === segment.blocks.length
    ? toolRunMeta.summaryMeta
    : getReplayToolRunSummaryMeta(visibleSegment)

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
        <span className="replay-tool-group__label">{label}</span>
        {summaryMeta ? <span className="replay-tool-group__meta">{summaryMeta}</span> : null}
      </summary>
      <div className="replay-tool-group__content">
        {visibleBlocks.map((block) => (
          <ReplayPlaybackUnit key={block.id} playback={playback} unitId={block.id}>
            <ReplayBlockDisclosure
              block={block}
              html={blockHtml.get(block.id) ?? ''}
              meta={getRequiredBlockLayout(blockMetaById, block.id)}
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
  children: ReactNode
  playback?: ReplayTurnPlaybackState
  unitId: string
}) {
  if (playback && !playback.revealAll && !playback.visibleUnitIds.has(unitId)) {
    return null
  }

  const isActive = playback?.activeUnitId === unitId
  const shouldAnimate = Boolean(playback?.animate && playback.visibleUnitIds.has(unitId))

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

function ReplayInlineBlock({ block, html }: { block: ReplayRenderableTextBlock; html: string }) {
  return (
    <div className={`replay-inline-block replay-inline-block--${block.type}`}>
      {block.type !== 'meta' && block.title ? <div className="replay-inline-block__title">{block.title}</div> : null}
      <div
        className="replay-inline-block__content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function ReplayBlockDisclosure({
  block,
  html,
  meta,
  isOpen,
  onToggle,
}: {
  block: ReplayRenderableBlock
  html: string
  meta: PreparedBlockLayout
  isOpen: boolean
  onToggle: () => void
}) {
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
        <span className="replay-disclosure__summary-label">{meta.label}</span>
        {meta.summaryMeta ? <span className="replay-disclosure__summary-meta">{meta.summaryMeta}</span> : null}
      </summary>
      <div
        className={meta.contentClassName}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </details>
  )
}

function getRequiredBlockLayout(
  blockMetaById: ReadonlyMap<string, PreparedBlockLayout>,
  blockId: string,
): PreparedBlockLayout {
  const meta = blockMetaById.get(blockId)
  if (!meta) {
    throw new Error(`Missing prepared block layout for block ${blockId}`)
  }

  return meta
}

function getRequiredToolRunLayout(
  toolRunMetaById: ReadonlyMap<string, PreparedToolRunLayout>,
  segmentId: string,
): PreparedToolRunLayout {
  const meta = toolRunMetaById.get(segmentId)
  if (!meta) {
    throw new Error(`Missing prepared tool run layout for segment ${segmentId}`)
  }

  return meta
}

function formatPreviewRoleLabel(role: ReplayRole): string {
  return `${role}:`.toUpperCase()
}
