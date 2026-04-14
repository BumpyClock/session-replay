import MarkdownIt from 'markdown-it'
import type { ReplayTurn } from '../api/contracts'
import { isReplayToolBlock } from '../replay/blocks'
import { expandReplayBlocks, isReplayMetaBlock, type ReplayMetaBlock, type ReplayRenderableBlock } from '../replay/context-blocks'
import { formatReplayToolBodyHtml, formatReplayToolStatusLabel } from '../replay/tool-format'

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
})

const defaultLinkRenderer =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]?.attrSet('rel', 'noreferrer noopener')
  tokens[index]?.attrSet('target', '_blank')

  return defaultLinkRenderer(tokens, index, options, env, self)
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderMarkdownHtml(markdownSource: string): string {
  const normalized = markdownSource.trim()

  if (!normalized) {
    return ''
  }

  return markdown.render(normalized)
}

export function renderReplayBlockHtml(block: ReplayRenderableBlock): string {
  return `<section class="replay-body-block replay-body-block--${escapeHtml(block.type)}">
    ${renderReplayBlockTitleHtml(block)}
    ${renderReplayBlockBodyHtml(block)}
  </section>`
}

/**
 * Shared body renderer for preview cards and exported HTML.
 * Meta blocks use `appearance` to switch between compact pills and disclosure bodies.
 */
export function renderReplayBlockBodyHtml(block: ReplayRenderableBlock): string {
  if (isReplayToolBlock(block)) {
    return formatReplayToolBodyHtml(block)
  }

  if (isReplayMetaBlock(block)) {
    return renderReplayMetaBlockBodyHtml(block)
  }

  if (block.type === 'code' || block.type === 'json') {
    const languageClass = block.language ? ` class="language-${escapeHtml(block.language)}"` : ''

    return `<pre><code${languageClass}>${escapeHtml(block.text)}</code></pre>`
  }

  if (block.type === 'markdown') {
    const content = renderMarkdownHtml(block.text)

    return `<div class="markdown-render">${content}</div>`
  }

  return `<div class="replay-text-render">${escapeHtml(block.text)}</div>`
}

export function renderReplayTurnBodyHtml(turn: Pick<ReplayTurn, 'blocks'>): string {
  return expandReplayBlocks(turn.blocks).map(renderReplayBlockHtml).join('')
}

function renderReplayBlockTitleHtml(block: ReplayRenderableBlock): string {
  if (isReplayToolBlock(block)) {
    const statusLabel = formatReplayToolStatusLabel(block)
    const status = statusLabel ? ` · ${escapeHtml(statusLabel)}` : ''
    return `<div class="replay-block-title">${escapeHtml(block.name)}${status}</div>`
  }

  if (isReplayMetaBlock(block)) {
    if (block.appearance === 'inline') {
      return ''
    }

    return `<div class="replay-block-title">${escapeHtml(`${block.label} · ${block.title}`)}</div>`
  }

  return block.title ? `<div class="replay-block-title">${escapeHtml(block.title)}</div>` : ''
}

function renderReplayMetaBlockBodyHtml(block: ReplayMetaBlock): string {
  if (block.appearance === 'inline') {
    return `<div class="replay-meta-pill replay-meta-pill--${escapeHtml(block.kind)}">
      <span class="replay-meta-pill__label">${escapeHtml(block.label)}</span>
      <span class="replay-meta-pill__title">${escapeHtml(block.title)}</span>
      ${block.summary ? `<span class="replay-meta-pill__summary">${escapeHtml(block.summary)}</span>` : ''}
    </div>`
  }

  const chips = block.chips?.length
    ? `<div class="replay-meta-card__chips">${block.chips
        .map((chip) => `<span class="replay-meta-chip">${escapeHtml(chip)}</span>`)
        .join('')}</div>`
    : ''
  const fields = block.fields?.length
    ? `<dl class="replay-meta-card__fields">${block.fields
        .map(
          (field) =>
            `<div class="replay-meta-card__field"><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`,
        )
        .join('')}</dl>`
    : ''
  const body = block.body
    ? `<div class="replay-meta-card__body">${
        block.bodyFormat === 'markdown'
          ? renderMarkdownHtml(block.body)
          : `<p>${escapeHtml(block.body)}</p>`
      }</div>`
    : ''
  const raw = shouldRenderReplayMetaRaw(block) && block.raw
    ? `<details class="replay-meta-card__raw">
      <summary>Raw transcript</summary>
      <pre><code>${escapeHtml(block.raw)}</code></pre>
    </details>`
    : ''

  return `<div class="replay-meta-card replay-meta-card--${escapeHtml(block.kind)}">
    <div class="replay-meta-card__header">
      <div class="replay-meta-card__title">${escapeHtml(block.title)}</div>
      ${chips}
    </div>
    ${body}
    ${fields}
    ${raw}
  </div>`
}

function shouldRenderReplayMetaRaw(block: ReplayMetaBlock): boolean {
  return !['skill-context', 'invoked-skills', 'workspace-instructions'].includes(block.kind)
}
