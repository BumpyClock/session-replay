import type {
  ReplayToolBlock,
  ReplayTurn,
} from '../api/contracts'
import {
  expandReplayBlocks,
  isReplayMetaBlock,
  summarizeReplayMetaBlock,
  type ReplayMetaBlock,
  type ReplayRenderableBlock,
  type ReplayRenderableTextBlock,
} from './context-blocks'
import { formatReplayToolPreview } from './tool-format'

export type ReplayTurnTone = 'default' | 'thinking' | 'tool'

export function isReplayToolBlock(block: ReplayRenderableBlock): block is ReplayToolBlock {
  return block.type === 'tool'
}

export function isReplayTextBlock(block: ReplayRenderableBlock): block is ReplayRenderableTextBlock {
  return block.type !== 'tool'
}

export function getReplayBlockLabel(block: ReplayRenderableBlock): string {
  if (isReplayToolBlock(block)) {
    return `Tool: ${block.name}`
  }

  if (isReplayMetaBlock(block)) {
    return block.label
  }

  if (block.type === 'thinking') {
    return 'Thinking'
  }

  return block.title ?? 'Text'
}

export function getReplayBlockDefaultOpen(block: ReplayRenderableBlock): boolean {
  if (isReplayMetaBlock(block)) {
    return false
  }

  return block.type !== 'thinking' && block.type !== 'tool'
}

export function getReplayBlockSummaryMeta(block: ReplayRenderableBlock): string | null {
  if (isReplayToolBlock(block)) {
    const snippet = formatReplayToolPreview(block, 72)
    const parts = [block.status, snippet].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  if (isReplayMetaBlock(block)) {
    const parts = [block.title, ...(block.chips ?? []).slice(0, 2)].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  if (block.type === 'thinking') {
    return truncateInlineText(block.text, 72)
  }

  return null
}

export function getReplayTurnTone(turn: Pick<ReplayTurn, 'blocks'>): ReplayTurnTone {
  const renderableBlocks = expandReplayBlocks(turn.blocks)

  if (renderableBlocks.some((block) => block.type === 'tool')) {
    return 'tool'
  }

  if (renderableBlocks.some((block) => block.type === 'thinking')) {
    return 'thinking'
  }

  return 'default'
}

export function summarizeReplayBlocks(blocks: readonly ReplayRenderableBlock[]): string {
  let textCount = 0
  let thinkingCount = 0
  let toolCount = 0

  for (const block of blocks) {
    if (block.type === 'tool') {
      toolCount += 1
      continue
    }

    if (isReplayMetaBlock(block)) {
      continue
    }

    if (block.type === 'thinking') {
      thinkingCount += 1
      continue
    }

    textCount += 1
  }

  const parts: string[] = []
  if (textCount > 0) {
    parts.push(`${textCount} text`)
  }
  if (thinkingCount > 0) {
    parts.push(`${thinkingCount} thinking`)
  }
  if (toolCount > 0) {
    parts.push(`${toolCount} tool call${toolCount === 1 ? '' : 's'}`)
  }

  return parts.join(', ') || 'empty'
}

export function summarizeReplayTurn(turn: ReplayTurn): string {
  const renderableBlocks = expandReplayBlocks(turn.blocks)

  if (turn.label?.trim()) {
    return turn.label.trim()
  }

  if (turn.role === 'assistant') {
    const assistantSummary = summarizeReplayBlocks(renderableBlocks)
    if (assistantSummary !== 'empty') {
      return assistantSummary
    }
  }

  const firstTextBlock = renderableBlocks.find(
    (block): block is Exclude<ReplayRenderableTextBlock, ReplayMetaBlock> =>
      isReplayTextBlock(block) && !isReplayMetaBlock(block) && block.text.trim().length > 0,
  )
  if (!firstTextBlock) {
    const firstMetaBlock = renderableBlocks.find(isReplayMetaBlock)
    if (firstMetaBlock) {
      return summarizeReplayMetaBlock(firstMetaBlock)
    }

    return `Turn ${turn.index + 1}`
  }

  return truncateText(firstTextBlock.text.trim(), 56)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength).trimEnd()}...`
}

function truncateInlineText(value: string, maxLength: number): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  return truncateText(normalized, maxLength)
}
