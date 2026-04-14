import type { ReplayBlock, ReplayToolBlock } from '../api/contracts'
import { getReplayBlockDefaultOpen, getReplayBlockLabel } from './blocks'
import { expandReplayBlocks, type ReplayRenderableTextBlock } from './context-blocks'

export type ReplaySegment =
  | {
      id: string
      type: 'block'
      block: ReplayRenderableTextBlock
    }
  | {
      id: string
      type: 'tool-run'
      blocks: ReplayToolBlock[]
    }

/**
 * Preserve source order while collapsing contiguous tool blocks into a single
 * "tool run" segment for disclosure UIs.
 */
export function createReplaySegments(blocks: readonly ReplayBlock[]): ReplaySegment[] {
  const segments: ReplaySegment[] = []
  let toolRun: ReplayToolBlock[] = []

  const flushToolRun = () => {
    if (toolRun.length === 0) {
      return
    }

    segments.push({
      id: toolRun.length === 1 ? toolRun[0].id : `tool-run:${toolRun[0].id}:${toolRun[toolRun.length - 1].id}`,
      type: 'tool-run',
      blocks: toolRun,
    })
    toolRun = []
  }

  for (const block of expandReplayBlocks(blocks)) {
    if (block.type === 'tool') {
      toolRun.push(block)
      continue
    }

    flushToolRun()
    segments.push({
      id: block.id,
      type: 'block',
      block,
    })
  }

  flushToolRun()
  return segments
}

export function getReplaySegmentDefaultOpen(segment: ReplaySegment): boolean {
  if (segment.type === 'block') {
    return getReplayBlockDefaultOpen(segment.block)
  }

  return false
}

export function getReplaySegmentDisclosureIds(segment: ReplaySegment): string[] {
  if (segment.type === 'block') {
    return segment.block.type === 'thinking'
      || (segment.block.type === 'meta' && segment.block.appearance === 'disclosure')
      ? [segment.block.id]
      : []
  }

  // Group-level toggles fan out to child tool disclosures so expand/collapse-all
  // keeps grouped runs and individual tool panels in sync.
  return [segment.id, ...segment.blocks.map((block) => block.id)]
}

export function shouldGroupReplayToolRun(segment: Extract<ReplaySegment, { type: 'tool-run' }>): boolean {
  return segment.blocks.length > 1
}

export function getReplayToolRunLabel(segment: Extract<ReplaySegment, { type: 'tool-run' }>): string {
  if (segment.blocks.length === 1) {
    return getReplayBlockLabel(segment.blocks[0])
  }

  return `${segment.blocks.length} tool calls`
}

export function getReplayToolRunSummaryMeta(
  segment: Extract<ReplaySegment, { type: 'tool-run' }>,
): string | null {
  const names = [...new Set(segment.blocks.map((block) => block.name.trim()).filter(Boolean))]
  const failedCount = segment.blocks.filter((block) => block.isError || block.status === 'failed').length
  const parts: string[] = []

  if (names.length > 0) {
    parts.push(names.join(', '))
  }

  if (failedCount > 0) {
    parts.push(`${failedCount} failed`)
  }

  return parts.join(' · ') || null
}
