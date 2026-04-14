import type {
  ReplayBlock,
  ReplayTextBlock,
  ReplayToolBlock,
  ReplayTurn,
} from '../api/contracts'

export type ReplayTurnTone = 'default' | 'thinking' | 'tool'

export function isReplayToolBlock(block: ReplayBlock): block is ReplayToolBlock {
  return block.type === 'tool'
}

export function isReplayTextBlock(block: ReplayBlock): block is ReplayTextBlock {
  return block.type !== 'tool'
}

export function getReplayBlockLabel(block: ReplayBlock): string {
  if (isReplayToolBlock(block)) {
    return `Tool: ${block.name}`
  }

  if (block.type === 'thinking') {
    return 'Thinking'
  }

  return block.title ?? 'Text'
}

export function getReplayBlockDefaultOpen(block: ReplayBlock): boolean {
  return block.type !== 'thinking' && block.type !== 'tool'
}

export function getReplayBlockSummaryMeta(block: ReplayBlock): string | null {
  if (isReplayToolBlock(block)) {
    const snippet = truncateInlineText(block.output ?? block.input ?? '', 72)
    const parts = [block.status, snippet].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : null
  }

  if (block.type === 'thinking') {
    return truncateInlineText(block.text, 72)
  }

  return null
}

export function getReplayTurnTone(turn: Pick<ReplayTurn, 'blocks'>): ReplayTurnTone {
  if (turn.blocks.some((block) => block.type === 'tool')) {
    return 'tool'
  }

  if (turn.blocks.some((block) => block.type === 'thinking')) {
    return 'thinking'
  }

  return 'default'
}

export function summarizeReplayBlocks(blocks: readonly ReplayBlock[]): string {
  let textCount = 0
  let thinkingCount = 0
  let toolCount = 0

  for (const block of blocks) {
    if (block.type === 'tool') {
      toolCount += 1
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
  if (turn.label?.trim()) {
    return turn.label.trim()
  }

  if (turn.role === 'assistant') {
    return summarizeReplayBlocks(turn.blocks)
  }

  const firstTextBlock = turn.blocks.find(
    (block): block is ReplayTextBlock =>
      isReplayTextBlock(block) && block.text.trim().length > 0,
  )
  if (!firstTextBlock) {
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
