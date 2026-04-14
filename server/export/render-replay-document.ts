import type {
  MaterializedReplaySession,
  ReplayBlock,
  ReplayRenderOptions,
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

const DEFAULT_AUTOPLAY_DELAY = 1400
const HIDDEN_THINKING_LABEL = 'Thinking hidden for this export.'

/**
 * Renders a self-contained, viewer-only replay document.
 */
export function renderReplayDocument(
  session: MaterializedReplaySession,
  options: ReplayRenderOptions = {},
): string {
  const { initialTurnIndex, session: replay } = createRenderableSession(session, options)
  const displayTitle = escapeHtml(options.exportTitle ?? replay.title)
  const bookmarks = replay.bookmarks ?? []

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${displayTitle}</title>
    <style>${buildStyles()}</style>
  </head>
  <body>
    <div class="app-shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Session Replay Export</p>
          <h1>${displayTitle}</h1>
          <p class="summary">${escapeHtml(replay.summary ?? replay.description ?? 'Viewer-only session replay')}</p>
        </div>
        <dl class="meta-grid">
          ${renderMetaRow('Source', replay.source)}
          ${renderMetaRow('Project', replay.project)}
          ${renderMetaRow('Turns', String(replay.turns.length))}
          ${renderMetaRow('Updated', replay.updatedAt ?? replay.startedAt)}
        </dl>
      </header>
      <main class="content-grid">
        <aside class="sidebar">
          <section class="panel controls">
            <div class="control-row">
              <button class="control" data-action="first" type="button">First</button>
              <button class="control" data-action="prev" type="button">Prev</button>
              <button class="control primary" data-action="toggle-play" type="button">Play</button>
              <button class="control" data-action="next" type="button">Next</button>
              <button class="control" data-action="last" type="button">Last</button>
            </div>
            <div class="control-row control-row--secondary">
              <button class="control" data-action="expand-all" type="button">Expand all</button>
              <button class="control" data-action="collapse-all" type="button">Collapse all</button>
            </div>
            <label class="timeline">
              <span>Turn <output id="turn-counter">${replay.turns.length === 0 ? 0 : initialTurnIndex + 1}</output> / ${replay.turns.length}</span>
              <input id="turn-slider" type="range" min="0" max="${Math.max(replay.turns.length - 1, 0)}" value="${initialTurnIndex}" ${replay.turns.length === 0 ? 'disabled' : ''} />
            </label>
          </section>
          ${
            bookmarks.length > 0
              ? `<section class="panel">
            <h2>Bookmarks</h2>
            <div class="bookmark-list">
              ${bookmarks
                .map(
                  (bookmark) =>
                    `<button class="bookmark" data-turn-index="${bookmark.turnIndex}" type="button">${escapeHtml(bookmark.label)}</button>`,
                )
                .join('')}
            </div>
          </section>`
              : ''
          }
          <section class="panel">
            <h2>Turns</h2>
            <div class="turn-list">
              ${replay.turns
                .map((turn, turnIndex) => renderTurnListItem(turn, turnIndex === initialTurnIndex))
                .join('')}
            </div>
          </section>
        </aside>
        <section class="panel viewer">
          ${
            replay.turns.length === 0
              ? '<div class="empty">No turns available in this export</div>'
              : replay.turns
                  .map((turn, turnIndex) => renderTurnPanel(turn, turnIndex, turnIndex === initialTurnIndex))
                  .join('')
          }
        </section>
      </main>
    </div>
    <script>${buildRuntime(Math.max(options.autoplayDelayMs ?? DEFAULT_AUTOPLAY_DELAY, 300))}</script>
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
 * Shapes exported replay data after editor filtering so bookmarks, playback indices,
 * and disclosure defaults stay aligned with the visible turn list.
 */
function createRenderableSession(
  session: MaterializedReplaySession,
  options: ReplayRenderOptions,
): {
  initialTurnIndex: number
  session: MaterializedReplaySession
} {
  const includeThinking = options.includeThinking ?? true
  const includeToolCalls = options.includeToolCalls ?? true
  const keepTimestamps = options.keepTimestamps ?? true
  const revealThinking = options.revealThinking ?? false
  const includedTurns = session.turns.filter((turn) => turn.included !== false)
  const visibleTurnIndexMap = new Map<number, number>()
  const turns = includedTurns.flatMap((turn, originalVisibleIndex) => {
    const blocks = turn.blocks.flatMap((block) => {
      if (block.type === 'tool') {
        return includeToolCalls ? [block] : []
      }

      if (block.type !== 'thinking') {
        return [block]
      }

      if (!includeThinking) {
        return []
      }

      if (revealThinking) {
        return [block]
      }

      return [
        {
          ...block,
          text: HIDDEN_THINKING_LABEL,
        },
      ]
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
      startedAt: keepTimestamps ? session.startedAt : undefined,
      turns,
      updatedAt: keepTimestamps ? session.updatedAt : undefined,
    },
  }
}

function renderMetaRow(label: string, value?: string): string {
  if (!value) {
    return ''
  }

  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
}

function renderTurnListItem(turn: ReplayTurn, active: boolean): string {
  const time = turn.timestamp
    ? `<span class="turn-time">${escapeHtml(turn.timestamp)}</span>`
    : ''
  const tone = getReplayTurnTone(turn)

  return `<button class="turn-item turn-item--${escapeHtml(tone)}${active ? ' is-active' : ''}" data-turn-index="${turn.index}" type="button">
    <span class="turn-role role-${escapeHtml(turn.role)}">${escapeHtml(turn.role)}</span>
    <span class="turn-label">${escapeHtml(summarizeReplayTurn(turn))}</span>
    ${time}
  </button>`
}

function renderTurnPanel(turn: ReplayTurn, turnIndex: number, active: boolean): string {
  const time = turn.timestamp ? `<time>${escapeHtml(turn.timestamp)}</time>` : ''
  const tone = getReplayTurnTone(turn)

  return `<article class="turn-panel turn-panel--${escapeHtml(tone)}${active ? ' is-active' : ''}" data-turn-index="${turnIndex}" ${active ? '' : 'hidden'}>
    <header class="turn-header">
      <div>
        <span class="turn-role role-${escapeHtml(turn.role)}">${escapeHtml(turn.role)}</span>
        <h2>${escapeHtml(turn.label ?? `Turn ${turnIndex + 1}`)}</h2>
      </div>
      ${time}
    </header>
    <details class="turn-disclosure" open>
      <summary class="turn-disclosure-summary">${escapeHtml(summarizeReplayTurn(turn))}</summary>
      <div class="turn-body">${turn.blocks.map(renderReplayTurnBlock).join('')}</div>
    </details>
  </article>`
}

function renderReplayTurnBlock(block: ReplayBlock): string {
  const open = getReplayBlockDefaultOpen(block)
  const summaryMeta = getReplayBlockSummaryMeta(block)

  return `<details class="turn-block turn-block--${escapeHtml(block.type)}"${open ? ' open' : ''}>
    <summary class="turn-block-summary">
      <span class="turn-block-summary-label">${escapeHtml(getReplayBlockLabel(block))}</span>
      ${summaryMeta ? `<span class="turn-block-summary-meta">${escapeHtml(summaryMeta)}</span>` : ''}
    </summary>
    <div class="turn-block-content">${renderReplayBlockBodyHtml(block)}</div>
  </details>`
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function buildStyles(): string {
  return `:root {
  color-scheme: light;
  --bg: #ede9e2;
  --surface: rgba(250, 249, 246, 0.78);
  --surface-solid: rgba(255, 255, 255, 0.94);
  --surface-hover: rgba(255, 255, 255, 0.9);
  --border: rgba(0, 0, 0, 0.08);
  --text: #191919;
  --text-muted: #787774;
  --primary: #2383e2;
  --primary-soft: rgba(35, 131, 226, 0.1);
  --success: #25a244;
  --warning: #e07328;
  --danger: #d92d20;
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 20px;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  font-family: Inter, "Segoe UI", system-ui, sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: radial-gradient(circle at top, rgba(255,255,255,0.6), transparent 40%), var(--bg); color: var(--text); }
body { padding: 24px; }
button, input { font: inherit; }
button { cursor: pointer; }
pre, code { white-space: pre-wrap; word-break: break-word; }
.app-shell { max-width: 1280px; margin: 0 auto; display: grid; gap: 24px; }
.hero, .panel { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); backdrop-filter: blur(18px) saturate(1.2); box-shadow: var(--shadow); }
.hero { display: grid; gap: 20px; padding: 24px; }
.hero h1 { margin: 0; font-size: clamp(2rem, 4vw, 3rem); line-height: 1.05; letter-spacing: -0.03em; }
.eyebrow, .summary, .meta-grid dt, .turn-time { color: var(--text-muted); }
.eyebrow { margin: 0 0 8px; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.14em; }
.summary { margin: 12px 0 0; max-width: 70ch; line-height: 1.5; }
.meta-grid { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.meta-grid div { padding: 14px 16px; border-radius: var(--radius-md); background: var(--surface-solid); border: 1px solid var(--border); }
.meta-grid dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
.meta-grid dd { margin: 8px 0 0; font-size: 0.95rem; font-variant-numeric: tabular-nums; }
.content-grid { display: grid; gap: 24px; grid-template-columns: minmax(280px, 320px) minmax(0, 1fr); }
.sidebar, .viewer { display: grid; gap: 16px; align-self: start; }
.panel { padding: 16px; }
.controls { position: sticky; top: 24px; z-index: 1; }
.control-row { display: flex; flex-wrap: wrap; gap: 8px; }
.control-row--secondary { margin-top: 8px; }
.control, .bookmark, .turn-item { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-solid); color: var(--text); transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease; }
.control:hover, .bookmark:hover, .turn-item:hover { background: var(--surface-hover); transform: translateY(-1px); }
.control:focus-visible, .bookmark:focus-visible, .turn-item:focus-visible, input:focus-visible { outline: 2px solid rgba(35, 131, 226, 0.45); outline-offset: 2px; }
.control { min-height: 44px; padding: 0 14px; }
.primary { background: var(--primary); color: white; border-color: transparent; }
.timeline { margin-top: 14px; display: grid; gap: 10px; color: var(--text-muted); }
.timeline input { width: 100%; }
.bookmark-list, .turn-list { display: grid; gap: 8px; }
.bookmark { min-height: 44px; padding: 0 14px; text-align: left; }
.turn-item { width: 100%; display: grid; gap: 6px; padding: 12px 14px; text-align: left; }
.turn-item.is-active, .turn-panel.is-active { border-color: rgba(35, 131, 226, 0.26); background: rgba(255,255,255,0.97); }
.turn-item--thinking, .turn-panel--thinking { border-left: 3px solid rgba(224, 115, 40, 0.55); }
.turn-item--tool, .turn-panel--tool { border-left: 3px solid rgba(35, 131, 226, 0.55); }
.turn-role { display: inline-flex; width: fit-content; align-items: center; justify-content: center; min-height: 24px; padding: 0 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; text-transform: capitalize; }
.role-user { background: rgba(35, 131, 226, 0.11); color: var(--primary); }
.role-assistant { background: rgba(37, 162, 68, 0.11); color: var(--success); }
.role-system { background: rgba(224, 115, 40, 0.11); color: var(--warning); }
.role-tool { background: rgba(217, 45, 32, 0.11); color: var(--danger); }
.turn-label { font-weight: 600; line-height: 1.4; }
.viewer { min-height: 640px; }
.turn-panel { display: grid; gap: 18px; }
.turn-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: center; }
.turn-header h2 { margin: 10px 0 0; font-size: 1.15rem; }
.turn-disclosure, .turn-block { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); overflow: hidden; }
.turn-disclosure-summary, .turn-block-summary { list-style: none; display: flex; align-items: center; gap: 10px; padding: 14px 16px; cursor: pointer; font-weight: 600; }
.turn-disclosure-summary::-webkit-details-marker, .turn-block-summary::-webkit-details-marker { display: none; }
.turn-disclosure-summary::before, .turn-block-summary::before { content: '▸'; color: var(--text-muted); transition: transform 120ms ease; }
.turn-disclosure[open] > .turn-disclosure-summary::before, .turn-block[open] > .turn-block-summary::before { transform: rotate(90deg); }
.turn-disclosure-summary { background: rgba(15, 23, 42, 0.04); }
.turn-body { display: grid; gap: 12px; padding: 0 16px 16px; }
.turn-block-summary { font-size: 0.92rem; }
.turn-block-summary-label { flex: 0 1 auto; }
.turn-block-summary-meta { color: var(--text-muted); font-size: 0.82rem; font-weight: 500; margin-left: auto; text-align: right; }
.turn-block-content { display: grid; gap: 10px; padding: 0 16px 16px; }
.turn-block--thinking { border-style: dashed; }
.turn-block--thinking .turn-block-summary,
.turn-block--tool .turn-block-summary { font-size: 0.82rem; }
.turn-block--thinking .turn-block-content,
.turn-block--tool .turn-block-content { font-size: 0.92rem; color: var(--text-muted); }
.turn-block--tool .turn-block-summary { color: var(--danger); }
.replay-body-block { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); padding: 16px; }
.replay-body-block--thinking { border-style: dashed; }
.replay-block-title { margin-bottom: 10px; color: var(--text-muted); font-size: 0.83rem; text-transform: uppercase; letter-spacing: 0.08em; }
.replay-toolcall-grid { display: grid; gap: 10px; }
.replay-toolcall-section { display: grid; gap: 8px; }
.replay-toolcall-label { color: var(--text-muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.08em; }
.replay-text-render { white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
.markdown-render { display: grid; gap: 12px; line-height: 1.6; }
.markdown-render > :first-child { margin-top: 0; }
.markdown-render > :last-child { margin-bottom: 0; }
.markdown-render p, .markdown-render ul, .markdown-render ol, .markdown-render pre, .markdown-render blockquote, .markdown-render table { margin: 0; }
.markdown-render ul, .markdown-render ol { padding-left: 1.25rem; }
.markdown-render li + li { margin-top: 4px; }
.markdown-render a { color: var(--primary); text-decoration: underline; text-underline-offset: 0.18em; }
.markdown-render blockquote { padding-left: 14px; border-left: 3px solid rgba(35, 131, 226, 0.2); color: var(--text-muted); }
.markdown-render code { padding: 0.16rem 0.38rem; border-radius: 8px; background: rgba(15, 23, 42, 0.06); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
.markdown-render pre { overflow: auto; padding: 14px; border-radius: var(--radius-sm); background: rgba(15, 23, 42, 0.08); }
.markdown-render pre code { padding: 0; border-radius: 0; background: transparent; display: block; }
.markdown-render table { width: 100%; border-collapse: collapse; }
.markdown-render th, .markdown-render td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; }
.markdown-render hr { width: 100%; border: 0; border-top: 1px solid var(--border); }
.empty { min-height: 320px; display: grid; place-items: center; color: var(--text-muted); }
@media (max-width: 900px) {
  body { padding: 16px; }
  .content-grid { grid-template-columns: 1fr; }
  .controls { position: static; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}`
}

function buildRuntime(autoplayDelayMs: number): string {
  return `(function () {
  const panels = Array.from(document.querySelectorAll('.turn-panel'));
  const turnButtons = Array.from(document.querySelectorAll('.turn-item'));
  const jumpButtons = Array.from(document.querySelectorAll('[data-turn-index]'));
  const slider = document.getElementById('turn-slider');
  const counter = document.getElementById('turn-counter');
  const togglePlay = document.querySelector('[data-action="toggle-play"]');
  const first = document.querySelector('[data-action="first"]');
  const prev = document.querySelector('[data-action="prev"]');
  const next = document.querySelector('[data-action="next"]');
  const last = document.querySelector('[data-action="last"]');
  const expandAll = document.querySelector('[data-action="expand-all"]');
  const collapseAll = document.querySelector('[data-action="collapse-all"]');
  let index = panels.findIndex((panel) => !panel.hasAttribute('hidden'));
  let timer = null;

  if (index < 0) index = 0;

  function stopPlayback() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    if (togglePlay) togglePlay.textContent = 'Play';
  }

  function sync() {
    panels.forEach((panel, panelIndex) => {
      if (panelIndex === index) {
        panel.removeAttribute('hidden');
        panel.classList.add('is-active');
      } else {
        panel.setAttribute('hidden', '');
        panel.classList.remove('is-active');
      }
    });
    turnButtons.forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.turnIndex) === index);
    });
    if (slider) slider.value = String(index);
    if (counter) counter.textContent = panels.length === 0 ? '0' : String(index + 1);
  }

  function setIndex(nextIndex) {
    if (panels.length === 0) return;
    index = Math.min(Math.max(nextIndex, 0), panels.length - 1);
    sync();
  }

  function startPlayback() {
    if (timer || panels.length < 2) return;
    if (togglePlay) togglePlay.textContent = 'Pause';
    timer = window.setInterval(function () {
      if (index >= panels.length - 1) {
        stopPlayback();
        return;
      }
      setIndex(index + 1);
    }, ${autoplayDelayMs});
  }

  function setDisclosureState(open) {
    document.querySelectorAll('.turn-disclosure, .turn-block').forEach((node) => {
      node.open = open;
    });
  }

  jumpButtons.forEach((button) => {
    button.addEventListener('click', function () {
      const turnIndex = Number(button.dataset.turnIndex);
      stopPlayback();
      setIndex(turnIndex);
    });
  });

  if (slider) {
    slider.addEventListener('input', function () {
      stopPlayback();
      setIndex(Number(slider.value));
    });
  }

  if (togglePlay) {
    togglePlay.addEventListener('click', function () {
      if (timer) {
        stopPlayback();
        return;
      }
      startPlayback();
    });
  }

  if (first) first.addEventListener('click', function () { stopPlayback(); setIndex(0); });
  if (prev) prev.addEventListener('click', function () { stopPlayback(); setIndex(index - 1); });
  if (next) next.addEventListener('click', function () { stopPlayback(); setIndex(index + 1); });
  if (last) last.addEventListener('click', function () { stopPlayback(); setIndex(panels.length - 1); });
  if (expandAll) expandAll.addEventListener('click', function () { setDisclosureState(true); });
  if (collapseAll) collapseAll.addEventListener('click', function () { setDisclosureState(false); });

  sync();
}())`
}
