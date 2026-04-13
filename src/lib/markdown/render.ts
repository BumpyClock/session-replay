import MarkdownIt from 'markdown-it'
import type { ReplayBlock, ReplayToolCall, ReplayTurn } from '../api/contracts'

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
  const title = block.title ? `<div class="replay-block-title">${escapeHtml(block.title)}</div>` : ''

  if (block.type === 'code' || block.type === 'json') {
    const languageClass = block.language ? ` class="language-${escapeHtml(block.language)}"` : ''

    return `<section class="replay-body-block replay-body-block--${escapeHtml(block.type)}">
      ${title}
      <pre><code${languageClass}>${escapeHtml(block.text)}</code></pre>
    </section>`
  }

  if (block.type === 'markdown') {
    const content = renderMarkdownHtml(block.text)

    return `<section class="replay-body-block replay-body-block--${escapeHtml(block.type)}">
      ${title}
      <div class="markdown-render">${content}</div>
    </section>`
  }

  return `<section class="replay-body-block replay-body-block--${escapeHtml(block.type)}">
    ${title}
    <div class="replay-text-render">${escapeHtml(block.text)}</div>
  </section>`
}

export function renderReplayToolCallHtml(toolCall: ReplayToolCall): string {
  const status = toolCall.status ? ` · ${escapeHtml(toolCall.status)}` : ''
  const input = toolCall.input
    ? `<div class="replay-toolcall-section">
        <div class="replay-toolcall-label">Input</div>
        <pre><code>${escapeHtml(toolCall.input)}</code></pre>
      </div>`
    : ''
  const output = toolCall.output
    ? `<div class="replay-toolcall-section">
        <div class="replay-toolcall-label">Output</div>
        <pre><code>${escapeHtml(toolCall.output)}</code></pre>
      </div>`
    : ''

  return `<section class="replay-body-block replay-body-block--tool">
    <div class="replay-block-title">${escapeHtml(toolCall.name)}${status}</div>
    <div class="replay-toolcall-grid">${input}${output}</div>
  </section>`
}

export function renderReplayTurnBodyHtml(turn: Pick<ReplayTurn, 'blocks' | 'toolCalls'>): string {
  return [...turn.blocks.map(renderReplayBlockHtml), ...(turn.toolCalls ?? []).map(renderReplayToolCallHtml)].join('')
}
