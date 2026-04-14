import {
  Bookmark,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pause,
  Play,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  MaterializedReplaySession,
  ReplayBlock,
  ReplayRenderOptions,
  ReplayRole,
  ReplayTurn,
} from '../../src/lib/api/contracts'
import { renderReplayBlockBodyHtml } from '../../src/lib/markdown/render'
import {
  getReplayBlockDefaultOpen,
  getReplayBlockLabel,
  getReplayBlockSummaryMeta,
  getReplayTurnTone,
  summarizeReplayTurn,
} from '../../src/lib/replay/blocks'
import {
  createReplayPlaybackTurns,
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_TURN_DWELL_MS,
  PLAYBACK_SPEEDS,
  type ReplayPlaybackTurnPlan,
} from '../../src/lib/replay/playback'
import {
  createReplaySegments,
  getReplayToolRunLabel,
  getReplayToolRunSummaryMeta,
  shouldGroupReplayToolRun,
} from '../../src/lib/replay/segments'
import { type ReplayRenderableBlock, type ReplayRenderableTextBlock } from '../../src/lib/replay/context-blocks'

const roleIconMap = {
  assistant: Bot,
  system: Sparkles,
  tool: Wrench,
  user: UserRound,
} satisfies Record<ReplayRole, typeof Bot>

const PLAY_ICON = renderIconMarkup(Play, 16)
const PAUSE_ICON = renderIconMarkup(Pause, 16)
const PREVIOUS_ICON = renderIconMarkup(ChevronLeft, 16)
const NEXT_ICON = renderIconMarkup(ChevronRight, 16)
const CLOCK_ICON = renderIconMarkup(Clock, 14)
const BOOKMARK_ICON = renderIconMarkup(Bookmark, 12)
const CHEVRON_ICON = renderIconMarkup(ChevronDown, 12)

type RenderableReplaySession = MaterializedReplaySession & {
  bookmarksByTurnIndex: Map<number, string>
}

/**
 * Renders a self-contained replay document that mirrors the in-editor playback preview.
 */
export function renderReplayDocument(
  session: MaterializedReplaySession,
  options: ReplayRenderOptions = {},
): string {
  const { initialTurnIndex, session: replay } = createRenderableSession(session, options)
  const displayTitle = escapeHtml(options.exportTitle ?? replay.title)
  const playbackTurns = createReplayPlaybackTurns(replay.turns)
  const playbackSpeed = DEFAULT_PLAYBACK_SPEED

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${displayTitle}</title>
    <style>${buildStyles()}</style>
  </head>
  <body>
    <div class="export-page">
      <main class="preview-workspace export-page__preview">
        <section class="preview-block preview-block--export" aria-live="polite">
          <header class="preview-block__header">
            <div>
              <p class="eyebrow">Replay preview</p>
              <h2>Session playback</h2>
              <p class="preview-block__subtitle">${displayTitle}</p>
            </div>
            <div class="preview-block__meta">
              <div class="preview-block__count">
                ${CLOCK_ICON}
                ${replay.turns.length}/${replay.turns.length} visible
              </div>
              ${renderSessionMeta(replay)}
            </div>
          </header>
          <div class="preview-block__content preview-block__content--chat" data-playback-content>
            ${
              replay.turns.length === 0
                ? `<div class="preview-block__empty">
              <p>No turns available in this export.</p>
              <p class="preview-block__hint">Adjust export filters in editor mode if you expected more transcript content.</p>
            </div>`
                : `<ul class="preview-block__transcript">
              ${replay.turns.map((turn) => renderReplayTurnCard(turn, replay.bookmarksByTurnIndex.get(turn.index), options)).join('')}
            </ul>`
            }
          </div>
          <div class="preview-block__dock" role="toolbar" aria-label="Playback controls">
            <button
              aria-label="Play transcript"
              class="preview-block__action preview-block__action--icon"
              data-action="toggle-play"
              type="button"
              ${replay.turns.length === 0 ? 'disabled' : ''}
            >
              ${PLAY_ICON}
            </button>
            <button
              aria-label="Previous step"
              class="preview-block__action preview-block__action--icon"
              data-action="prev"
              type="button"
              disabled
            >
              ${PREVIOUS_ICON}
            </button>
            <button
              aria-label="Next step"
              class="preview-block__action preview-block__action--icon"
              data-action="next"
              type="button"
              ${replay.turns.length === 0 ? 'disabled' : ''}
            >
              ${NEXT_ICON}
            </button>
            <button
              aria-label="Playback speed ${playbackSpeed}x"
              class="preview-block__action preview-block__action--speed"
              data-action="speed"
              type="button"
            >
              ${playbackSpeed}x
            </button>
          </div>
        </section>
      </main>
    </div>
    <script>${buildRuntime({
      initialTurnIndex,
      pauseIcon: PAUSE_ICON,
      playIcon: PLAY_ICON,
      playbackTurns,
      speeds: [...PLAYBACK_SPEEDS],
    })}</script>
  </body>
</html>`
}

/**
 * Creates a safe file-stem for exported HTML documents.
 */
export function sanitizeDownloadName(title: string): string {
  const collapsed = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  return collapsed || 'session-replay'
}

/**
 * Shapes exported replay data after editor filtering so bookmarks and playback indices
 * stay aligned with the visible transcript.
 */
function createRenderableSession(
  session: MaterializedReplaySession,
  options: ReplayRenderOptions,
): {
  initialTurnIndex: number
  session: RenderableReplaySession
} {
  const includeThinking = options.includeThinking ?? true
  const includeToolCalls = options.includeToolCalls ?? true
  const keepTimestamps = options.keepTimestamps ?? true
  const includedTurns = session.turns.filter((turn) => turn.included !== false)
  // Export indices are rebuilt after filtering so bookmarks, initial turn selection,
  // and playback all target the surviving visible turn order.
  const visibleTurnIndexMap = new Map<number, number>()
  const turns = includedTurns.flatMap((turn, originalVisibleIndex) => {
    const blocks = turn.blocks.flatMap((block) => {
      if (block.type === 'tool') {
        return includeToolCalls ? [block] : []
      }

      if (block.type !== 'thinking') {
        return [block]
      }

      return includeThinking ? [block] : []
    })
    if (blocks.length === 0) {
      return []
    }

    const nextIndex = visibleTurnIndexMap.size
    visibleTurnIndexMap.set(originalVisibleIndex, nextIndex)

    return [
      {
        ...turn,
        blocks,
        index: nextIndex,
        timestamp: keepTimestamps ? turn.timestamp : undefined,
      },
    ]
  })
  const bookmarks = (session.bookmarks ?? [])
    .flatMap((bookmark) => {
      const turnIndex = visibleTurnIndexMap.get(bookmark.turnIndex)

      if (turnIndex === undefined) {
        return []
      }

      return [
        {
          ...bookmark,
          turnIndex,
        },
      ]
    })
    .sort((left, right) => left.turnIndex - right.turnIndex)
  const bookmarksByTurnIndex = new Map(bookmarks.map((bookmark) => [bookmark.turnIndex, bookmark.label]))
  const requestedInitialTurnIndex = options.initialTurnIndex
  const initialTurnIndex = clampTurnIndex(
    resolveInitialTurnIndex(requestedInitialTurnIndex, visibleTurnIndexMap, includedTurns.length),
    turns.length,
  )

  return {
    initialTurnIndex,
    session: {
      ...session,
      bookmarks: bookmarks.length > 0 ? bookmarks : undefined,
      bookmarksByTurnIndex,
      startedAt: keepTimestamps ? session.startedAt : undefined,
      turns,
      updatedAt: keepTimestamps ? session.updatedAt : undefined,
    },
  }
}

function renderSessionMeta(session: Pick<RenderableReplaySession, 'project' | 'source' | 'updatedAt'>): string {
  const parts = [session.project, session.source, session.updatedAt ? formatDateLabel(session.updatedAt) : undefined].filter(Boolean)
  if (parts.length === 0) {
    return ''
  }

  return `<p class="preview-block__meta-note">${escapeHtml(parts.join(' · '))}</p>`
}

function renderReplayTurnCard(
  turn: ReplayTurn,
  bookmarkLabel: string | undefined,
  options: ReplayRenderOptions,
): string {
  const Icon = roleIconMap[turn.role]
  const tone = getReplayTurnTone(turn)
  const summary = summarizeReplayTurn(turn)
  const timeLabel = formatTimeLabel(turn.timestamp)
  const bookmark = bookmarkLabel
    ? `<div class="replay-turn__note-pill">
        ${BOOKMARK_ICON}
        ${escapeHtml(bookmarkLabel)}
      </div>`
    : ''

  return `<li
    class="replay-turn replay-turn--${escapeHtml(tone)}"
    data-turn-id="${escapeHtml(turn.id)}"
    data-turn-index="${turn.index}"
  >
    <div class="replay-turn__icon">
      ${renderIconMarkup(Icon, 12)}
    </div>
    <div class="replay-turn__meta">
      <div class="replay-turn__header">
        <div class="replay-turn__top">
          <span class="replay-turn__role-label">${escapeHtml(formatReplayRoleLabel(turn.role))}</span>
          <span class="replay-turn__summary-inline">${escapeHtml(summary)}</span>
        </div>
        ${
          timeLabel
            ? `<time class="replay-turn__timestamp" datetime="${escapeHtml(turn.timestamp ?? '')}">${escapeHtml(timeLabel)}</time>`
            : ''
        }
        ${bookmark}
      </div>
      <div class="replay-turn__body">
        ${renderReplayTurnSegments(turn.blocks, options)}
      </div>
      ${bookmarkLabel ? '<span class="replay-turn__bookmark">bookmarked</span>' : ''}
    </div>
  </li>`
}

function renderReplayTurnSegments(blocks: readonly ReplayBlock[], options: ReplayRenderOptions): string {
  return createReplaySegments(blocks)
    .map((segment) => {
      if (segment.type === 'block') {
        if (segment.block.type !== 'thinking' && !(segment.block.type === 'meta' && segment.block.appearance === 'disclosure')) {
          return renderReplayPlaybackUnit(
            segment.block.id,
            renderReplayInlineBlock(segment.block),
          )
        }

        return renderReplayPlaybackUnit(
          segment.block.id,
          renderReplayBlockDisclosure(segment.block, options),
        )
      }

      if (!shouldGroupReplayToolRun(segment)) {
        return `<div class="replay-tool-run">
          ${segment.blocks
            .map((block) => renderReplayPlaybackUnit(block.id, renderReplayBlockDisclosure(block, options)))
            .join('')}
        </div>`
      }

      const summaryMeta = getReplayToolRunSummaryMeta(segment)
      return `<details
        class="replay-tool-group"
        data-replay-group-ids="${escapeHtml(segment.blocks.map((block) => block.id).join(','))}"
      >
        <summary class="replay-tool-group__summary">
          ${CHEVRON_ICON}
          <span class="replay-tool-group__label">${escapeHtml(getReplayToolRunLabel(segment))}</span>
          ${summaryMeta ? `<span class="replay-tool-group__meta">${escapeHtml(summaryMeta)}</span>` : ''}
        </summary>
        <div class="replay-tool-group__content">
          ${segment.blocks
            .map((block) => renderReplayPlaybackUnit(block.id, renderReplayBlockDisclosure(block, options)))
            .join('')}
        </div>
      </details>`
    })
    .join('')
}

function renderReplayPlaybackUnit(unitId: string, content: string): string {
  return `<div class="replay-playback-unit" data-replay-unit-id="${escapeHtml(unitId)}">${content}</div>`
}

function renderReplayInlineBlock(block: ReplayRenderableTextBlock): string {
  const title =
    block.type !== 'meta' && 'title' in block && block.title
      ? `<div class="replay-inline-block__title">${escapeHtml(block.title)}</div>`
      : ''

  return `<div class="replay-inline-block replay-inline-block--${escapeHtml(block.type)}">
    ${title}
    <div class="replay-inline-block__content">${renderReplayBlockBodyHtml(block)}</div>
  </div>`
}

function renderReplayBlockDisclosure(
  block: ReplayRenderableBlock,
  options: ReplayRenderOptions,
): string {
  const summaryMeta = getReplayBlockSummaryMeta(block)
  const open = getReplayBlockOpenState(block, options)
  const replayKind =
    block.type === 'thinking' ? ' data-replay-kind="thinking"' : block.type === 'tool' ? ' data-replay-kind="tool"' : ''
  const contentClassName =
    block.type === 'tool'
      ? 'replay-disclosure__content replay-disclosure__content--tool'
      : block.type === 'meta'
        ? 'replay-disclosure__content replay-disclosure__content--meta'
        : 'replay-disclosure__content'

  return `<details class="replay-disclosure replay-disclosure--${escapeHtml(block.type)}"${open ? ' open' : ''}${replayKind}>
    <summary class="replay-disclosure__summary">
      ${CHEVRON_ICON}
      <span class="replay-disclosure__summary-label">${escapeHtml(getReplayBlockLabel(block))}</span>
      ${summaryMeta ? `<span class="replay-disclosure__summary-meta">${escapeHtml(summaryMeta)}</span>` : ''}
    </summary>
    <div class="${contentClassName}">${renderReplayBlockBodyHtml(block)}</div>
  </details>`
}

function getReplayBlockOpenState(block: ReplayRenderableBlock, options: ReplayRenderOptions): boolean {
  if (block.type === 'thinking' && (options.revealThinking ?? false)) {
    return true
  }

  return getReplayBlockDefaultOpen(block)
}

function clampTurnIndex(value: number, turnCount: number): number {
  if (turnCount === 0) {
    return 0
  }

  return Math.min(Math.max(value, 0), turnCount - 1)
}

function resolveInitialTurnIndex(
  requestedIndex: number | undefined,
  visibleTurnIndexMap: ReadonlyMap<number, number>,
  turnCountBeforeFiltering: number,
): number {
  if (requestedIndex === undefined) {
    return 0
  }

  const clampedRequestedIndex = clampTurnIndex(requestedIndex, turnCountBeforeFiltering)

  // If requested turn was filtered out, prefer nearest surviving turn after it,
  // then fall back to nearest surviving turn before it.
  for (let index = clampedRequestedIndex; index < turnCountBeforeFiltering; index += 1) {
    const mappedIndex = visibleTurnIndexMap.get(index)

    if (mappedIndex !== undefined) {
      return mappedIndex
    }
  }

  for (let index = clampedRequestedIndex - 1; index >= 0; index -= 1) {
    const mappedIndex = visibleTurnIndexMap.get(index)

    if (mappedIndex !== undefined) {
      return mappedIndex
    }
  }

  return 0
}

function formatReplayRoleLabel(role: ReplayTurn['role']): string {
  return `${role}:`.toUpperCase()
}

function formatTimeLabel(timestamp?: string): string {
  if (!timestamp) {
    return ''
  }

  const time = new Date(timestamp)
  if (Number.isNaN(time.valueOf())) {
    return timestamp
  }

  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(timestamp: string): string {
  const value = new Date(timestamp)
  if (Number.isNaN(value.valueOf())) {
    return timestamp
  }

  return value.toLocaleString([], {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderIconMarkup(Icon: typeof Bot, size: number): string {
  return renderToStaticMarkup(createElement(Icon, { 'aria-hidden': 'true', size, strokeWidth: 1.8 }))
}

function buildStyles(): string {
  return `:root {
  color-scheme: light;
  --color-bg: #ede9e2;
  --color-bg-alt: #f9f7f3;
  --color-surface: rgba(250, 249, 246, 0.55);
  --color-surface-solid: rgba(255, 255, 255, 0.55);
  --color-surface-hover: rgba(255, 255, 255, 0.45);
  --color-border: rgba(0, 0, 0, 0.06);
  --color-border-subtle: rgba(0, 0, 0, 0.04);
  --color-text: #191919;
  --color-text-muted: #37352f;
  --color-text-subtle: #787774;
  --color-primary: #2383e2;
  --color-primary-soft: rgba(35, 131, 226, 0.08);
  --color-success: #25a244;
  --color-success-soft: rgba(37, 162, 68, 0.08);
  --color-warning: #e07328;
  --color-warning-soft: rgba(224, 115, 40, 0.08);
  --color-danger: #d92d20;
  --color-danger-soft: rgba(217, 45, 32, 0.08);
  --r-lg: 20px;
  --r-md: 16px;
  --r-sm: 10px;
  --r-xs: 6px;
  --r-pill: 9999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --font-size-2: 10px;
  --font-size-3: 11px;
  --font-size-4: 12px;
  --font-size-5: 12.5px;
  --font-size-6: 13px;
  --font-size-8: 18px;
  --font-stack: 'Inter', 'Avenir Next', 'Segoe UI', sans-serif;
  --mono-stack: ui-monospace, Consolas, monospace;
  --lh-tight: 1.15;
  --lh-base: 1.45;
  --tracking-tight: -0.02em;
  --focus-ring: 0 0 0 2px rgba(35, 131, 226, 0.22);
  --shadow-subtle: 0 18px 40px rgba(20, 20, 20, 0.08);
  --shadow-line: 0 0 0 1px var(--color-border);
  --motion-fast: 120ms;
  --motion-panel: 210ms;
  --ease-enter: cubic-bezier(0.215, 0.61, 0.355, 1);
  --ease-hover: cubic-bezier(0.25, 0.8, 0.25, 1);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  min-height: 100%;
  margin: 0;
}

body {
  min-height: 100svh;
  color: var(--color-text);
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 128, 45, 0.08), transparent 52%),
    radial-gradient(circle at 80% 80%, rgba(170, 75, 225, 0.08), transparent 46%),
    var(--color-bg);
  font-family: var(--font-stack);
  font-size: 15px;
  font-weight: 400;
  line-height: var(--lh-base);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(52% 52% at 15% 20%, rgba(255, 128, 45, 0.22), transparent 58%),
    radial-gradient(42% 42% at 86% 8%, rgba(170, 75, 225, 0.14), transparent 52%),
    radial-gradient(38% 38% at 78% 80%, rgba(35, 131, 226, 0.12), transparent 56%);
  opacity: 0.75;
}

body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
  opacity: 0.05;
}

p,
h1,
h2,
h3,
h4,
h5 {
  margin: 0;
}

button,
input,
select {
  font: inherit;
}

button {
  font-family: var(--font-stack);
}

pre,
code {
  white-space: pre-wrap;
  word-break: break-word;
}

.export-page {
  position: relative;
  z-index: 1;
  min-height: 100svh;
  padding: 16px;
  display: flex;
  align-items: stretch;
  justify-content: center;
}

.preview-workspace {
  border-radius: var(--r-md);
  box-shadow: var(--shadow-subtle);
  border: 1px solid var(--color-border);
  background: linear-gradient(180deg, var(--color-surface), color-mix(in srgb, var(--color-surface-solid) 80%, transparent));
  backdrop-filter: blur(14px);
}

.export-page__preview {
  width: min(100%, 1040px);
  min-height: calc(100svh - 32px);
  display: flex;
  flex-direction: column;
}

.preview-block {
  border-radius: inherit;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.preview-block--export {
  position: relative;
  isolation: isolate;
}

.preview-block__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: var(--shadow-line);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-surface-solid) 95%, transparent),
    color-mix(in srgb, var(--color-surface) 88%, transparent)
  );
  backdrop-filter: blur(12px);
}

.preview-block__header h2 {
  font-size: var(--font-size-8);
  line-height: var(--lh-tight);
  letter-spacing: var(--tracking-tight);
}

.eyebrow {
  margin-bottom: var(--space-2);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
  font-size: 9px;
  color: var(--color-text-subtle);
}

.preview-block__subtitle,
.preview-block__meta-note,
.preview-block__hint,
.preview-block__empty,
.replay-turn__role-label,
.replay-turn__summary-inline,
.replay-turn__timestamp {
  color: var(--color-text-subtle);
}

.preview-block__subtitle,
.preview-block__meta-note {
  font-size: var(--font-size-4);
}

.preview-block__meta {
  display: grid;
  justify-items: end;
  gap: var(--space-2);
  text-align: right;
}

.preview-block__count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--r-xs);
  font-size: var(--font-size-3);
  color: var(--color-text-subtle);
}

.preview-block__content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: var(--space-2) var(--space-4) calc(84px + var(--space-5));
  overscroll-behavior: contain;
  scroll-behavior: smooth;
}

.preview-block__transcript {
  margin: 0;
  padding: 0;
  list-style: none;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.preview-block__empty {
  margin-top: auto;
}

.preview-block__hint {
  margin-top: var(--space-2);
}

.preview-block__dock {
  position: absolute;
  left: 50%;
  bottom: var(--space-3);
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: max-content;
  max-width: calc(100% - (var(--space-4) * 2));
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(26, 31, 40, 0.96), rgba(12, 16, 24, 0.92));
  box-shadow:
    0 18px 48px rgba(5, 7, 11, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(18px);
  transform: translateX(-50%);
}

.preview-block__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: transparent;
  color: rgba(244, 247, 252, 0.82);
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--ease-enter),
    border-color var(--motion-fast) var(--ease-enter),
    color var(--motion-fast) var(--ease-enter),
    transform var(--motion-fast) var(--ease-enter);
}

.preview-block__action:not(:disabled):hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
}

.preview-block__action:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.preview-block__action--active {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.96);
}

.preview-block__action--icon {
  min-width: 44px;
  padding: 0;
}

.preview-block__action--speed {
  min-width: 56px;
  font-variant-numeric: tabular-nums;
}

.preview-block__action:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.replay-turn {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-left: 3px solid color-mix(in srgb, var(--color-text-subtle) 28%, transparent);
  border-radius: var(--r-sm);
  padding: var(--space-3);
  background: var(--color-surface-hover);
}

.replay-turn--thinking {
  border-left-color: color-mix(in srgb, var(--color-warning) 56%, transparent);
}

.replay-turn--system {
  border-left-color: color-mix(in srgb, var(--color-warning) 48%, transparent);
}

.replay-turn--tool {
  border-left-color: color-mix(in srgb, var(--color-primary) 56%, transparent);
}

.replay-turn.is-playback-past {
  opacity: 0.58;
}

.replay-turn.is-playback-active {
  border-left-color: color-mix(in srgb, var(--color-primary) 72%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.replay-turn__icon {
  width: 24px;
  height: 24px;
  border-radius: var(--r-pill);
  border: 1px solid var(--color-border);
  display: grid;
  place-items: center;
  color: var(--color-text-subtle);
}

.replay-turn--thinking .replay-turn__icon,
.replay-turn--system .replay-turn__icon {
  color: var(--color-warning);
}

.replay-turn--tool .replay-turn__icon {
  color: var(--color-primary);
}

.replay-turn__header {
  display: grid;
  gap: 2px;
  margin-bottom: var(--space-3);
}

.replay-turn__meta {
  min-width: 0;
}

.replay-turn__top {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-3);
}

.replay-turn__role-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--font-size-2);
}

.replay-turn__summary-inline {
  min-width: 0;
  text-align: right;
  font-size: var(--font-size-2);
}

.replay-turn__timestamp {
  font-size: var(--font-size-2);
}

.replay-turn__body,
.replay-disclosure__content {
  display: grid;
  gap: var(--space-3);
}

.replay-turn__bookmark {
  display: inline-flex;
  margin-top: var(--space-1);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 9px;
  color: var(--color-primary);
}

.replay-turn__note-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  width: fit-content;
  min-height: 32px;
  margin-top: var(--space-2);
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--color-border));
  border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--color-primary-soft) 76%, var(--color-surface-solid));
  color: var(--color-text);
  font-size: var(--font-size-3);
}

.replay-inline-block {
  display: grid;
  gap: var(--space-2);
}

.replay-inline-block--meta {
  gap: 0;
}

.replay-inline-block__title {
  color: var(--color-text-subtle);
  font-size: var(--font-size-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.replay-inline-block__content {
  display: grid;
  gap: var(--space-2);
}

.replay-playback-unit.is-revealed {
  animation: replay-block-reveal 220ms cubic-bezier(0.23, 1, 0.32, 1);
}

.replay-playback-unit.is-active .replay-disclosure,
.replay-playback-unit.is-active .replay-tool-group,
.replay-playback-unit.is-active .replay-inline-block {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.replay-disclosure {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--color-surface-solid) 88%, transparent);
  overflow: hidden;
}

.replay-disclosure__summary {
  list-style: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-3);
  cursor: pointer;
  font-size: var(--font-size-3);
  font-weight: 600;
}

.replay-disclosure__summary::-webkit-details-marker,
.replay-tool-group__summary::-webkit-details-marker,
.replay-meta-card__raw summary::-webkit-details-marker {
  display: none;
}

.replay-disclosure__summary-label {
  flex: 0 1 auto;
}

.replay-disclosure__summary-meta,
.replay-tool-group__meta {
  margin-left: auto;
  color: var(--color-text-subtle);
  font-size: var(--font-size-3);
  font-weight: 500;
  text-align: right;
}

.replay-disclosure__summary svg,
.replay-tool-group__summary svg {
  flex-shrink: 0;
  color: var(--color-text-subtle);
  transition: transform 160ms ease;
}

.replay-disclosure[open] .replay-disclosure__summary svg,
.replay-tool-group[open] .replay-tool-group__summary svg {
  transform: rotate(180deg);
}

.replay-disclosure__content {
  padding: 0 var(--space-3) var(--space-3);
}

.replay-disclosure--thinking {
  border-style: dashed;
}

.replay-disclosure--meta {
  background: color-mix(in srgb, var(--color-surface-solid) 94%, transparent);
}

.replay-disclosure--thinking .replay-disclosure__summary,
.replay-disclosure--tool .replay-disclosure__summary,
.replay-disclosure--meta .replay-disclosure__summary {
  font-size: var(--font-size-2);
}

.replay-disclosure--thinking .replay-disclosure__summary-meta,
.replay-disclosure--tool .replay-disclosure__summary-meta,
.replay-disclosure--meta .replay-disclosure__summary-meta {
  font-size: var(--font-size-2);
}

.replay-disclosure--thinking .replay-disclosure__content,
.replay-disclosure--tool .replay-disclosure__content,
.replay-disclosure--meta .replay-disclosure__content {
  font-size: var(--font-size-5);
  color: var(--color-text-subtle);
}

.replay-disclosure--tool .replay-disclosure__summary,
.replay-tool-group__summary {
  color: var(--color-primary);
}

.replay-disclosure__content--tool,
.replay-disclosure__content--meta {
  padding-top: 2px;
}

.replay-tool-run,
.replay-tool-group__content {
  display: grid;
  gap: var(--space-3);
}

.replay-tool-group {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--color-surface-solid) 88%, transparent);
  overflow: hidden;
}

.replay-tool-group__summary {
  list-style: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-3);
  cursor: pointer;
  font-size: var(--font-size-3);
  font-weight: 600;
}

.replay-tool-group__content {
  padding: 0 var(--space-3) var(--space-3);
}

.replay-meta-pill {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: calc(var(--space-1) + 2px) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--color-surface-solid) 92%, transparent);
  color: var(--color-text-subtle);
}

.replay-meta-pill__label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--font-size-2);
}

.replay-meta-pill__title {
  color: var(--color-text);
  font-size: var(--font-size-3);
  font-weight: 600;
}

.replay-meta-pill__summary {
  font-size: var(--font-size-3);
}

.replay-meta-card {
  display: grid;
  gap: var(--space-3);
}

.replay-meta-card__header {
  display: grid;
  gap: var(--space-2);
}

.replay-meta-card__title {
  color: var(--color-text);
  font-size: var(--font-size-4);
  font-weight: 600;
}

.replay-meta-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.replay-meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 var(--space-2);
  border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 14%, var(--color-border));
  color: var(--color-text-subtle);
  font-size: var(--font-size-2);
  text-transform: lowercase;
}

.replay-meta-card__body p {
  margin: 0;
}

.replay-meta-card__fields {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}

.replay-meta-card__field {
  display: grid;
  gap: 2px;
}

.replay-meta-card__field dt {
  color: var(--color-text-subtle);
  font-size: var(--font-size-2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.replay-meta-card__field dd {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-3);
}

.replay-meta-card__raw {
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--color-surface-solid) 96%, transparent);
}

.replay-meta-card__raw summary {
  cursor: pointer;
  list-style: none;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-subtle);
  font-size: var(--font-size-2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.replay-meta-card__raw pre {
  margin: 0;
  padding: 0 var(--space-3) var(--space-3);
}

.replay-toolcall-empty {
  color: var(--color-text-subtle);
  font-size: var(--font-size-4);
}

.replay-toolcall-section--error pre,
.replay-tool-result--error pre {
  border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-border));
  background: color-mix(in srgb, var(--color-danger-soft) 68%, transparent);
}

.replay-diff {
  display: grid;
  gap: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--r-sm);
  overflow: hidden;
}

.replay-diff__file {
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color-text) 4%, transparent);
  color: var(--color-text-subtle);
  font-size: var(--font-size-2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.replay-diff__line {
  padding: 4px 12px;
  font-family: var(--mono-stack);
  font-size: var(--font-size-4);
  white-space: pre-wrap;
  word-break: break-word;
}

.replay-diff__line--ctx {
  background: color-mix(in srgb, var(--color-text) 2%, transparent);
}

.replay-diff__line--add {
  background: color-mix(in srgb, var(--color-success-soft) 78%, transparent);
  color: color-mix(in srgb, var(--color-success) 88%, black);
}

.replay-diff__line--del {
  background: color-mix(in srgb, var(--color-danger-soft) 78%, transparent);
  color: color-mix(in srgb, var(--color-danger) 88%, black);
}

.replay-tool-result,
.markdown-render,
.replay-text-render {
  display: grid;
  gap: var(--space-2);
}

.replay-text-render {
  white-space: pre-wrap;
  line-height: 1.6;
}

.markdown-render {
  line-height: 1.6;
}

.markdown-render > :first-child {
  margin-top: 0;
}

.markdown-render > :last-child {
  margin-bottom: 0;
}

.markdown-render p,
.markdown-render ul,
.markdown-render ol,
.markdown-render pre,
.markdown-render blockquote,
.markdown-render table {
  margin: 0;
}

.markdown-render ul,
.markdown-render ol {
  padding-left: 1.25rem;
}

.markdown-render li + li {
  margin-top: 4px;
}

.markdown-render a {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

.markdown-render blockquote {
  padding-left: 14px;
  border-left: 3px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
  color: var(--color-text-subtle);
}

.markdown-render code {
  padding: 0.16rem 0.38rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-text) 6%, transparent);
  font-family: var(--mono-stack);
  font-size: 0.92em;
}

.markdown-render pre {
  overflow: auto;
  padding: 14px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
}

.markdown-render pre code {
  padding: 0;
  border-radius: 0;
  background: transparent;
  display: block;
}

.markdown-render table {
  width: 100%;
  border-collapse: collapse;
}

.markdown-render th,
.markdown-render td {
  border: 1px solid var(--color-border);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.markdown-render hr {
  width: 100%;
  border: 0;
  border-top: 1px solid var(--color-border);
}

@keyframes replay-block-reveal {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .preview-block__action,
  .preview-block__dock,
  .replay-playback-unit.is-revealed,
  .replay-disclosure__summary svg,
  .replay-tool-group__summary svg {
    transition: none;
    animation: none;
  }
}

@media (max-width: 900px) {
  .export-page {
    padding: 10px;
  }

  .export-page__preview {
    width: 100%;
    min-height: calc(100svh - 20px);
  }

  .preview-block__header {
    align-items: start;
    flex-direction: column;
  }

  .preview-block__meta {
    justify-items: start;
    text-align: left;
  }
}`
}

function buildRuntime({
  initialTurnIndex,
  pauseIcon,
  playIcon,
  playbackTurns,
  speeds,
}: {
  initialTurnIndex: number
  pauseIcon: string
  playIcon: string
  playbackTurns: readonly ReplayPlaybackTurnPlan[]
  speeds: readonly number[]
}): string {
  const defaultSpeedIndex = Math.max(speeds.indexOf(DEFAULT_PLAYBACK_SPEED), 0)

  // Export runtime stays self-contained, but mirrors src/lib/replay/playback.ts so
  // standalone HTML playback matches editor preview pacing and reveal semantics.
  return `(function () {
  const playbackTurns = ${JSON.stringify(playbackTurns)};
  const initialTurnIndex = ${initialTurnIndex};
  const playIcon = ${JSON.stringify(playIcon)};
  const pauseIcon = ${JSON.stringify(pauseIcon)};
  const speeds = ${JSON.stringify(speeds)};
  const defaultSpeedIndex = ${defaultSpeedIndex};
  const content = document.querySelector('[data-playback-content]');
  const turnNodes = Array.from(document.querySelectorAll('.replay-turn'));
  const playButton = document.querySelector('[data-action="toggle-play"]');
  const previousButton = document.querySelector('[data-action="prev"]');
  const nextButton = document.querySelector('[data-action="next"]');
  const speedButton = document.querySelector('[data-action="speed"]');
  let mode = 'idle';
  let speedIndex = defaultSpeedIndex;
  let turnIndex = 0;
  let timer = null;
  let initialScrollDone = false;
  let visibleUnitIds = new Set();
  const turnIndexById = new Map(playbackTurns.map((turn, index) => [turn.turnId, index]));

  function clearTimer() {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  function resetPlayback() {
    turnIndex = 0;
    visibleUnitIds = new Set();
  }

  function playbackComplete() {
    return playbackTurns.length > 0
      && turnIndex >= playbackTurns.length - 1
      && playbackTurns.every((turn) => turn.units.every((unit) => visibleUnitIds.has(unit.id)));
  }

  function playbackCanStepBackward() {
    const activeTurn = playbackTurns[turnIndex];
    return playbackTurns.length > 0 && Boolean(
      turnIndex > 0 || (activeTurn && activeTurn.units.some((unit) => visibleUnitIds.has(unit.id)))
    );
  }

  function getActivePlaybackUnitId(turn) {
    if (!turn) {
      return null;
    }

    for (let index = turn.units.length - 1; index >= 0; index -= 1) {
      const candidate = turn.units[index];
      if (candidate && visibleUnitIds.has(candidate.id)) {
        return candidate.id;
      }
    }

    return null;
  }

  function getNextPlaybackDelay() {
    const currentTurn = playbackTurns[turnIndex];
    if (!currentTurn) {
      return null;
    }

    const nextUnit = currentTurn.units.find((unit) => !visibleUnitIds.has(unit.id));
    if (nextUnit) {
      return Math.max(60, Math.round(nextUnit.delayMs / (speeds[speedIndex] || 1)));
    }

    if (turnIndex < playbackTurns.length - 1) {
      return Math.max(120, Math.round(${PLAYBACK_TURN_DWELL_MS} / (speeds[speedIndex] || 1)));
    }

    return null;
  }

  function getNextPlaybackState() {
    const currentTurn = playbackTurns[turnIndex];
    if (!currentTurn) {
      return null;
    }

    const nextUnit = currentTurn.units.find((unit) => !visibleUnitIds.has(unit.id));
    if (nextUnit) {
      const nextVisible = new Set(visibleUnitIds);
      nextVisible.add(nextUnit.id);
      return { revealedUnitIds: nextVisible, turnIndex };
    }

    if (turnIndex < playbackTurns.length - 1) {
      return { revealedUnitIds: new Set(visibleUnitIds), turnIndex: turnIndex + 1 };
    }

    return null;
  }

  function getPreviousPlaybackState() {
    const currentTurn = playbackTurns[turnIndex];
    if (!currentTurn) {
      return null;
    }

    for (let index = currentTurn.units.length - 1; index >= 0; index -= 1) {
      const unit = currentTurn.units[index];
      if (unit && visibleUnitIds.has(unit.id)) {
        const nextVisible = new Set(visibleUnitIds);
        nextVisible.delete(unit.id);
        return { revealedUnitIds: nextVisible, turnIndex };
      }
    }

    if (turnIndex > 0) {
      return { revealedUnitIds: new Set(visibleUnitIds), turnIndex: turnIndex - 1 };
    }

    return null;
  }

  function syncTurnUnits(node, playbackIndex) {
    const playbackStarted = mode !== 'idle';
    const playbackTurn = playbackIndex === undefined ? undefined : playbackTurns[playbackIndex];
    const isPlaybackPast = playbackStarted && playbackIndex !== undefined && playbackIndex < turnIndex;
    const isPlaybackActive = playbackStarted && playbackIndex === turnIndex;
    const revealAll = !playbackStarted || !playbackTurn || isPlaybackPast || (isPlaybackActive && playbackTurn.role === 'user');
    const turnVisibleUnitIds = revealAll
      ? new Set((playbackTurn ? playbackTurn.units : []).map((unit) => unit.id))
      : isPlaybackActive
        ? new Set(visibleUnitIds)
        : new Set();
    const activeUnitId = getActivePlaybackUnitId(playbackTurns[turnIndex]);

    node.querySelectorAll('.replay-playback-unit').forEach((unitNode) => {
      const unitId = unitNode.dataset.replayUnitId || '';
      const isVisible = revealAll || turnVisibleUnitIds.has(unitId);
      unitNode.hidden = !isVisible;
      unitNode.classList.toggle('is-active', Boolean(isPlaybackActive && activeUnitId === unitId));
      unitNode.classList.toggle('is-revealed', Boolean(isPlaybackActive && turnVisibleUnitIds.has(unitId)));
    });

    node.querySelectorAll('[data-replay-group-ids]').forEach((groupNode) => {
      const ids = (groupNode.dataset.replayGroupIds || '').split(',').filter(Boolean);
      const shouldHide = !revealAll && ids.every((id) => !turnVisibleUnitIds.has(id));
      groupNode.hidden = shouldHide;
    });
  }

  function sync() {
    const playbackStarted = mode !== 'idle';
    const activeTurnId = playbackTurns[turnIndex] ? playbackTurns[turnIndex].turnId : null;

    turnNodes.forEach((node) => {
      const playbackIndex = turnIndexById.get(node.dataset.turnId || '');
      const isPlaybackPast = playbackStarted && playbackIndex !== undefined && playbackIndex < turnIndex;
      const isPlaybackActive = playbackStarted && playbackIndex === turnIndex;
      node.hidden = Boolean(playbackStarted && playbackIndex !== undefined && playbackIndex > turnIndex);
      node.classList.toggle('is-playback-past', isPlaybackPast);
      node.classList.toggle('is-playback-active', isPlaybackActive);
      syncTurnUnits(node, playbackIndex);
    });

    if (playButton) {
      const isPlaying = mode === 'playing';
      playButton.innerHTML = isPlaying ? pauseIcon : playIcon;
      playButton.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Play transcript');
      playButton.classList.toggle('preview-block__action--active', isPlaying);
      playButton.disabled = playbackTurns.length === 0;
    }

    if (previousButton) {
      previousButton.disabled = !playbackCanStepBackward();
    }

    if (nextButton) {
      nextButton.disabled = playbackTurns.length === 0;
    }

    if (speedButton) {
      const speed = speeds[speedIndex] || 1;
      speedButton.textContent = speed + 'x';
      speedButton.setAttribute('aria-label', 'Playback speed ' + speed + 'x');
    }

    window.requestAnimationFrame(function () {
      const initialNode = turnNodes[initialTurnIndex];
      if (!initialScrollDone && initialNode && typeof initialNode.scrollIntoView === 'function') {
        initialNode.scrollIntoView({ behavior: 'auto', block: 'center' });
        initialScrollDone = true;
      }

      if (!playbackStarted) {
        return;
      }

      const activeNode = activeTurnId
        ? turnNodes.find((node) => node.dataset.turnId === activeTurnId && !node.hidden)
        : null;

      if (activeNode && typeof activeNode.scrollIntoView === 'function') {
        activeNode.scrollIntoView({
          behavior: mode === 'playing' ? 'smooth' : 'auto',
          block: 'end',
        });
        return;
      }

      if (content && typeof content.scrollTo === 'function') {
        content.scrollTo({
          behavior: mode === 'playing' ? 'smooth' : 'auto',
          top: content.scrollHeight,
        });
      }
    });
  }

  function schedulePlayback() {
    clearTimer();
    if (mode !== 'playing') {
      return;
    }

    const delayMs = getNextPlaybackDelay();
    if (delayMs === null) {
      mode = 'paused';
      sync();
      return;
    }

    timer = window.setTimeout(function () {
      const nextState = getNextPlaybackState();
      if (!nextState) {
        mode = 'paused';
        sync();
        return;
      }

      turnIndex = nextState.turnIndex;
      visibleUnitIds = nextState.revealedUnitIds;
      sync();
      schedulePlayback();
    }, delayMs);
  }

  if (playButton) {
    playButton.addEventListener('click', function () {
      if (mode === 'playing') {
        clearTimer();
        mode = 'paused';
        sync();
        return;
      }

      if (playbackTurns.length === 0) {
        return;
      }

      if (mode === 'idle' || playbackComplete()) {
        resetPlayback();
      }

      mode = 'playing';
      sync();
      schedulePlayback();
    });
  }

  if (previousButton) {
    previousButton.addEventListener('click', function () {
      if (!playbackCanStepBackward()) {
        return;
      }

      clearTimer();

      if (mode === 'idle') {
        resetPlayback();
        mode = 'paused';
        sync();
        return;
      }

      mode = 'paused';
      const previousState = getPreviousPlaybackState();
      if (!previousState) {
        resetPlayback();
        sync();
        return;
      }

      turnIndex = previousState.turnIndex;
      visibleUnitIds = previousState.revealedUnitIds;
      sync();
    });
  }

  if (nextButton) {
    nextButton.addEventListener('click', function () {
      if (playbackTurns.length === 0) {
        return;
      }

      const playbackWasStarted = mode !== 'idle';
      clearTimer();
      mode = 'paused';

      if (!playbackWasStarted || playbackComplete()) {
        resetPlayback();
        sync();
        return;
      }

      const nextState = getNextPlaybackState();
      if (!nextState) {
        sync();
        return;
      }

      turnIndex = nextState.turnIndex;
      visibleUnitIds = nextState.revealedUnitIds;
      sync();
    });
  }

  if (speedButton) {
    speedButton.addEventListener('click', function () {
      speedIndex = (speedIndex + 1) % speeds.length;
      sync();
      if (mode === 'playing') {
        schedulePlayback();
      }
    });
  }

  sync();
}())`
}
