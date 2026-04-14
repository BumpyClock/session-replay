import type { ReplayToolBlock } from '../api/contracts'
import {
  expandReplayTextBlock,
  isReplayMetaBlock,
  type ReplayMetaBlock,
} from './context-blocks'

export function formatReplayToolEditorText(block: ReplayToolBlock): string {
  const input = stringifyReplayToolValue(block.input)
  const output = block.output?.trim()

  return [block.name, input ? `Input\n${input}` : '', output ? `Result\n${output}` : '']
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Build compact tool summary text with tool-specific heuristics first,
 * then fall back to stringified input for unknown tool shapes.
 */
export function formatReplayToolPreview(block: ReplayToolBlock, maxLength = 60): string | null {
  const name = block.name.trim()
  const normalizedName = name.toLowerCase()
  const input = asObject(block.input)

  if (normalizedName === 'edit' || normalizedName === 'write' || normalizedName === 'read') {
    return truncateInlineText(stringFromObjectKey(input, 'file_path') ?? '', maxLength)
  }

  if (normalizedName === 'grep' || normalizedName === 'glob') {
    const pattern = stringFromObjectKey(input, 'pattern')
    const path = stringFromObjectKey(input, 'path')
    if (pattern && path) {
      return truncateInlineText(`${pattern} in ${path}`, maxLength)
    }

    return truncateInlineText(pattern ?? path ?? '', maxLength)
  }

  if (normalizedName === 'bash' || normalizedName === 'exec_command') {
    return truncateInlineText(stringFromObjectKey(input, 'command') ?? '', maxLength)
  }

  return truncateInlineText(stringifyReplayToolValue(block.input) ?? '', maxLength)
}

export function formatReplayToolStatusLabel(block: ReplayToolBlock): string | null {
  if (block.status) {
    return block.status
  }

  if (block.isError) {
    return 'failed'
  }

  if (block.output) {
    return 'completed'
  }

  return null
}

/**
 * Render escaped HTML for one replay tool block, with richer diff/write views
 * and structured meta-card output when a tool result is entirely control-plane
 * scaffolding instead of normal stdout/stderr text.
 */
export function formatReplayToolBodyHtml(block: ReplayToolBlock): string {
  const normalizedName = block.name.trim().toLowerCase()
  const input = asObject(block.input)

  if (normalizedName === 'edit' && input?.old_string != null && input?.new_string != null) {
    return renderEditDiffHtml({
      filePath: stringFromObjectKey(input, 'file_path'),
      isError: Boolean(block.isError),
      oldValue: String(input.old_string),
      output: block.output,
      replaceAll: Boolean(input.replace_all),
      newValue: String(input.new_string),
    })
  }

  if (normalizedName === 'write' && input?.content != null) {
    return renderWriteBodyHtml({
      content: String(input.content),
      filePath: stringFromObjectKey(input, 'file_path'),
      isError: Boolean(block.isError),
      output: block.output,
    })
  }

  let bodyHtml = ''
  const inputText = stringifyReplayToolValue(block.input)
  const outputText = block.output?.trim()

  if (inputText) {
    bodyHtml += `<div class="replay-toolcall-section">
      <div class="replay-toolcall-label">Input</div>
      <pre><code>${escapeHtml(inputText)}</code></pre>
    </div>`
  }

  if (outputText) {
    const outputClass = block.isError ? ' replay-toolcall-section--error' : ''
    const renderedOutput = renderStructuredToolOutput(block.id, outputText)
    bodyHtml += `<div class="replay-toolcall-section${outputClass}">
      <div class="replay-toolcall-label">Result</div>
      ${renderedOutput ?? `<pre><code>${escapeHtml(outputText)}</code></pre>`}
    </div>`
  }

  return `<div class="replay-toolcall-grid">${bodyHtml || '<div class="replay-toolcall-empty">No tool payload</div>'}</div>`
}

export function stringifyReplayToolValue(value: unknown): string | null {
  if (value == null) {
    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderEditDiffHtml({
  filePath,
  isError,
  oldValue,
  output,
  replaceAll,
  newValue,
}: {
  filePath: string | null
  isError: boolean
  oldValue: string
  output?: string
  replaceAll: boolean
  newValue: string
}): string {
  const oldLines = oldValue.split('\n')
  const newLines = newValue.split('\n')
  const diffHeader = `${filePath ?? 'Edited content'}${replaceAll ? ' (replace all)' : ''}`
  let diffHtml = `<div class="replay-diff">
    <div class="replay-diff__file">${escapeHtml(diffHeader)}</div>`

  // Skip the expensive LCS path for very large edits; coarse before/after
  // output is still more useful than blocking the renderer.
  if (oldLines.length * newLines.length > 50_000) {
    for (const line of oldLines) {
      diffHtml += `<div class="replay-diff__line replay-diff__line--del">${escapeHtml(`- ${line}`)}</div>`
    }
    for (const line of newLines) {
      diffHtml += `<div class="replay-diff__line replay-diff__line--add">${escapeHtml(`+ ${line}`)}</div>`
    }
  } else {
    const diffLines = buildDiffLines(oldLines, newLines)
    for (const entry of diffLines) {
      diffHtml += `<div class="replay-diff__line replay-diff__line--${entry.kind}">${escapeHtml(entry.text)}</div>`
    }
  }

  diffHtml += '</div>'

  if (!output?.trim()) {
    return diffHtml
  }

  return `${diffHtml}${renderResultBlock(output, isError)}`
}

function renderWriteBodyHtml({
  content,
  filePath,
  isError,
  output,
}: {
  content: string
  filePath: string | null
  isError: boolean
  output?: string
}): string {
  const fileLabel = escapeHtml(filePath ?? 'Written content')
  const code = escapeHtml(content)
  const base = `<div class="replay-diff">
    <div class="replay-diff__file">${fileLabel}</div>
    <pre><code>${code}</code></pre>
  </div>`

  if (!output?.trim()) {
    return base
  }

  return `${base}${renderResultBlock(output, isError)}`
}

function renderResultBlock(output: string, isError: boolean): string {
  const renderedOutput = renderStructuredToolOutput('tool-result', output.trim())

  return `<div class="replay-tool-result${isError ? ' replay-tool-result--error' : ''}">
    <div class="replay-toolcall-label">Result</div>
    ${renderedOutput ?? `<pre><code>${escapeHtml(output.trim())}</code></pre>`}
  </div>`
}

function renderStructuredToolOutput(id: string, output: string): string | null {
  const blocks = expandReplayTextBlock({
    id: `${id}:tool-output`,
    type: 'text',
    text: output,
  })
  const metaBlocks = blocks.filter(isReplayMetaBlock)

  if (blocks.length === 0 || metaBlocks.length !== blocks.length) {
    return null
  }

  return metaBlocks.map(renderToolMetaBlockHtml).join('')
}

function renderToolMetaBlockHtml(block: ReplayMetaBlock): string {
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
          ? `<div class="replay-text-render">${escapeHtml(block.body)}</div>`
          : `<p>${escapeHtml(block.body)}</p>`
      }</div>`
    : ''
  const raw = block.raw
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

function buildDiffLines(
  oldLines: readonly string[],
  newLines: readonly string[],
): Array<{ kind: 'add' | 'ctx' | 'del'; text: string }> {
  // Classic LCS line diff. O(m*n), so callers should avoid it for huge edits.
  const m = oldLines.length
  const n = newLines.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let oldIndex = m - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = n - 1; newIndex >= 0; newIndex -= 1) {
      dp[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? dp[oldIndex + 1][newIndex + 1] + 1
          : Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1])
    }
  }

  const lines: Array<{ kind: 'add' | 'ctx' | 'del'; text: string }> = []
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < m || newIndex < n) {
    if (oldIndex < m && newIndex < n && oldLines[oldIndex] === newLines[newIndex]) {
      lines.push({ kind: 'ctx', text: `  ${oldLines[oldIndex]}` })
      oldIndex += 1
      newIndex += 1
      continue
    }

    if (newIndex < n && (oldIndex >= m || dp[oldIndex][newIndex + 1] >= dp[oldIndex + 1][newIndex])) {
      lines.push({ kind: 'add', text: `+ ${newLines[newIndex]}` })
      newIndex += 1
      continue
    }

    lines.push({ kind: 'del', text: `- ${oldLines[oldIndex]}` })
    oldIndex += 1
  }

  return lines
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function stringFromObjectKey(object: Record<string, unknown> | null, key: string): string | null {
  const value = object?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function truncateInlineText(value: string, maxLength: number): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
