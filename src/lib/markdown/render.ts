import MarkdownIt from 'markdown-it'
import type { ReplayBlock, ReplayTurn } from '../api/contracts'
import { isReplayToolBlock } from '../replay/blocks'
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

export function renderReplayBlockHtml(block: ReplayBlock): string {
  return `<section class="replay-body-block replay-body-block--${escapeHtml(block.type)}">
    ${renderReplayBlockTitleHtml(block)}
    ${renderReplayBlockBodyHtml(block)}
  </section>`
}

export function renderReplayBlockBodyHtml(block: ReplayBlock): string {
  if (isReplayToolBlock(block)) {
    return formatReplayToolBodyHtml(block)
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
  return turn.blocks.map(renderReplayBlockHtml).join('')
}

function renderReplayBlockTitleHtml(block: ReplayBlock): string {
  if (isReplayToolBlock(block)) {
    const statusLabel = formatReplayToolStatusLabel(block)
    const status = statusLabel ? ` · ${escapeHtml(statusLabel)}` : ''
    return `<div class="replay-block-title">${escapeHtml(block.name)}${status}</div>`
  }

  return block.title ? `<div class="replay-block-title">${escapeHtml(block.title)}</div>` : ''
}
