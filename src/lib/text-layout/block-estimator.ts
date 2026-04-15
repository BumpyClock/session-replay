/**
 * Block classification and estimator metadata for height estimation.
 *
 * Pure logic with no browser dependencies. Produces metadata that the
 * browser-side Pretext cache will consume to measure text heights.
 */

import type { ReplayRenderableBlock } from '../replay/context-blocks'
import type { BlockEstimatorMeta, EstimatorCategory } from './block-estimator-types'
import {
  FONT_BODY,
  FONT_CODE,
  FONT_DISCLOSURE,
  LINE_HEIGHT_BODY_PX,
  LINE_HEIGHT_CODE_PX,
  LINE_HEIGHT_DISCLOSURE_PX,
} from './typography'

// ---------------------------------------------------------------------------
// Complex markdown detection patterns
// ---------------------------------------------------------------------------

/** Fenced code blocks: ``` or ~~~ at line start. */
const CODE_FENCE_RE = /^(`{3,}|~{3,})/m

/** Markdown tables: pipe-delimited rows with separator line. */
const TABLE_RE = /^\|.+\|[ \t]*\n\|[-: |]+\|/m

/** Block-level markdown that changes vertical structure beyond plain paragraph flow. */
const BLOCK_MARKER_RE = /^(#{1,6}\s+|>\s+|[-*]\s+|\d+\.\s+)/m

/** Blank lines imply paragraph/list spacing we do not model yet. */
const PARAGRAPH_BREAK_RE = /\n\s*\n/

/**
 * Block-level HTML: opening tags that produce block elements.
 * Excludes inline tags like `<em>`, `<strong>`, `<code>`, `<br>`.
 */
const HTML_BLOCK_RE = /^<(div|table|section|details|pre|blockquote|iframe|form|dl|figure|aside|header|footer|nav|article|fieldset)\b/im

// ---------------------------------------------------------------------------
// Inline markdown stripping
// ---------------------------------------------------------------------------

/**
 * Strip inline markdown formatting from a line, preserving readable text.
 * Handles headings, bold/italic, links, images, inline code, list markers,
 * and blockquote markers.
 */
export function stripInlineMarkdown(source: string): string {
  return source
    .split('\n')
    .map(stripSingleLine)
    .join('\n')
}

function stripSingleLine(line: string): string {
  let result = line

  // Heading markers: ## Heading → Heading
  result = result.replace(/^#{1,6}\s+/, '')

  // Blockquote markers: > text → text
  result = result.replace(/^>\s*/, '')

  // Unordered list markers: - or * at line start
  result = result.replace(/^[-*]\s+/, '')

  // Ordered list markers: 1. at line start
  result = result.replace(/^\d+\.\s+/, '')

  // Images: ![alt](url) → alt
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')

  // Links: [text](url) → text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // Inline code: `code` → code
  result = result.replace(/`([^`]*)`/g, '$1')

  // Bold: **text** or __text__ → text
  result = result.replace(/\*\*([^*]*)\*\*/g, '$1')
  result = result.replace(/__([^_]*)__/g, '$1')

  // Italic: *text* or _text_ → text
  result = result.replace(/\*([^*]*)\*/g, '$1')
  result = result.replace(/\b_([^_]*)_\b/g, '$1')

  return result
}

// ---------------------------------------------------------------------------
// Block classification
// ---------------------------------------------------------------------------

/**
 * Classify a renderable block and produce estimator metadata.
 *
 * Pretext-eligible blocks get `measurableText`, `fontShorthand`, and
 * `lineHeightPx` filled in. Non-eligible blocks get a deterministic
 * `fallbackLineCount` instead.
 */
export function classifyBlock(block: ReplayRenderableBlock): BlockEstimatorMeta {
  if (block.type === 'tool') {
    return toolFallback(block)
  }

  if (block.type === 'meta') {
    return metaFallback(block)
  }

  if (block.type === 'code' || block.type === 'json') {
    return codeFallback(block.type, block.text)
  }

  if (block.type === 'thinking') {
    return pretextEligible('thinking', block.text, FONT_DISCLOSURE, LINE_HEIGHT_DISCLOSURE_PX, 'pre-wrap')
  }

  if (block.type === 'markdown') {
    return classifyMarkdown(block.text)
  }

  // Plain text
  return pretextEligible('text', block.text, FONT_BODY, LINE_HEIGHT_BODY_PX, 'pre-wrap')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classifyMarkdown(text: string): BlockEstimatorMeta {
  if (
    CODE_FENCE_RE.test(text)
    || TABLE_RE.test(text)
    || HTML_BLOCK_RE.test(text)
    || BLOCK_MARKER_RE.test(text)
    || PARAGRAPH_BREAK_RE.test(text)
  ) {
    return fallbackMeta('markdown-complex', text, FONT_BODY, LINE_HEIGHT_BODY_PX, 'normal')
  }

  const stripped = stripInlineMarkdown(text)
  return pretextEligible('markdown-simple', stripped, FONT_BODY, LINE_HEIGHT_BODY_PX, 'normal')
}

function pretextEligible(
  category: EstimatorCategory,
  text: string,
  fontShorthand: string,
  lineHeightPx: number,
  whiteSpaceMode: 'normal' | 'pre-wrap',
): BlockEstimatorMeta {
  return {
    category,
    pretextEligible: true,
    whiteSpaceMode,
    measurableText: text,
    fontShorthand,
    lineHeightPx,
    fallbackLineCount: null,
  }
}

function fallbackMeta(
  category: EstimatorCategory,
  text: string,
  fontShorthand: string,
  lineHeightPx: number,
  whiteSpaceMode: 'normal' | 'pre-wrap',
): BlockEstimatorMeta {
  return {
    category,
    pretextEligible: false,
    whiteSpaceMode,
    measurableText: null,
    fontShorthand,
    lineHeightPx,
    fallbackLineCount: countLines(text),
  }
}

function codeFallback(category: 'code' | 'json', text: string): BlockEstimatorMeta {
  return fallbackMeta(category, text, FONT_CODE, LINE_HEIGHT_CODE_PX, 'pre-wrap')
}

function toolFallback(block: { output?: string; input?: unknown }): BlockEstimatorMeta {
  // Estimate tool block size from input + output content.
  const inputLines = estimateToolInputLines(block.input)
  const outputLines = block.output ? countLines(block.output) : 0
  // Tool blocks always include at least a header row.
  const totalLines = Math.max(1, inputLines + outputLines)

  return {
    category: 'tool',
    pretextEligible: false,
    whiteSpaceMode: 'pre-wrap',
    measurableText: null,
    fontShorthand: FONT_DISCLOSURE,
    lineHeightPx: LINE_HEIGHT_DISCLOSURE_PX,
    fallbackLineCount: totalLines,
  }
}

function metaFallback(block: {
  appearance: 'disclosure' | 'inline'
  fields?: Array<{ label: string; value: string }>
  chips?: string[]
  body?: string
}): BlockEstimatorMeta {
  // Meta cards: header + chips + fields + body → rough line count.
  let lines = 1 // header
  if (block.chips?.length) {
    lines += 1
  }
  if (block.fields?.length) {
    lines += block.fields.length
  }
  if (block.body) {
    lines += countLines(block.body)
  }
  // Inline pills are compact single-row items.
  if (block.appearance === 'inline') {
    lines = 1
  }

  const isInline = block.appearance === 'inline'

  return {
    category: 'meta',
    pretextEligible: false,
    whiteSpaceMode: isInline ? 'normal' : 'pre-wrap',
    measurableText: null,
    fontShorthand: isInline ? FONT_BODY : FONT_DISCLOSURE,
    lineHeightPx: isInline ? LINE_HEIGHT_BODY_PX : LINE_HEIGHT_DISCLOSURE_PX,
    fallbackLineCount: lines,
  }
}

function countLines(text: string): number {
  if (!text) {
    return 1
  }

  const count = text.split('\n').length
  return Math.max(1, count)
}

function estimateToolInputLines(input: unknown): number {
  if (input == null) {
    return 0
  }

  if (typeof input === 'string') {
    return countLines(input)
  }

  try {
    const serialized = JSON.stringify(input, null, 2)
    return countLines(serialized)
  } catch {
    return 1
  }
}
