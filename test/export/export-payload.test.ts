import { describe, expect, it } from 'vitest'
import type { BlockEstimatorMeta } from '../../src/lib/text-layout/block-estimator-types'
import type { PreparedBlockLayout, PreparedTurnLayout, PreparedToolRunLayout } from '../../src/lib/replay/transcript-layout-types'
import type { ReplayPlaybackTurnPlan } from '../../src/lib/replay/playback'
import type { ReplaySegment } from '../../src/lib/replay/segments'
import { buildExportPayload, estimateTurnHeight, TURN_GAP_PX } from '../../server/export/export-payload'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEstimatorMeta(overrides: Partial<BlockEstimatorMeta> = {}): BlockEstimatorMeta {
  return {
    category: 'text',
    pretextEligible: false,
    whiteSpaceMode: 'normal',
    measurableText: null,
    fontShorthand: '14px/20px sans-serif',
    lineHeightPx: 20,
    fallbackLineCount: 2,
    ...overrides,
  }
}

function makeBlockMeta(overrides: Partial<PreparedBlockLayout> = {}): PreparedBlockLayout {
  return {
    bodyHtml: '<p>hello</p>',
    contentClassName: 'block',
    defaultOpen: false,
    disclosureIds: [],
    isDisclosure: false,
    label: 'Text',
    summaryMeta: null,
    estimatorMeta: makeEstimatorMeta(),
    ...overrides,
  }
}

function makeToolRunMeta(overrides: Partial<PreparedToolRunLayout> = {}): PreparedToolRunLayout {
  return {
    grouped: false,
    label: 'Tool run',
    summaryMeta: null,
    ...overrides,
  }
}

function makeTurnLayout(overrides: Partial<PreparedTurnLayout> & {
  segments?: ReplaySegment[]
  blockMetaById?: Map<string, PreparedBlockLayout>
  toolRunMetaById?: Map<string, PreparedToolRunLayout>
} = {}): PreparedTurnLayout {
  return {
    turnId: 'turn-1',
    rowId: 'row-1',
    segments: [],
    blockHtml: new Map(),
    blockMetaById: new Map(),
    disclosureIds: [],
    defaultOpenIds: new Set(),
    summary: 'Summary',
    previewText: '',
    tone: 'neutral' as const,
    playbackUnits: [],
    estimator: { disclosureCount: 0, playbackDurationMs: 0, segmentCount: 0, unitCount: 0 },
    toolRunMetaById: new Map(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildExportPayload
// ---------------------------------------------------------------------------

describe('buildExportPayload', () => {
  it('serializes turns with html and estimated heights', () => {
    const turns = [
      { id: 'turn-1', index: 0 },
      { id: 'turn-2', index: 1 },
    ]
    const htmlMap = new Map([
      ['turn-1', '<li>Row 1</li>'],
      ['turn-2', '<li>Row 2</li>'],
    ])
    const heightMap = new Map([
      ['turn-1', 120],
      ['turn-2', 200],
    ])
    const playbackTurns: ReplayPlaybackTurnPlan[] = [
      { turnId: 'turn-1', role: 'user', units: [{ id: 'u1', delayMs: 100 }] },
    ]

    const result = buildExportPayload(turns, htmlMap, heightMap, playbackTurns, 0)

    expect(result.turns).toHaveLength(2)
    expect(result.turns[0]).toEqual({
      id: 'turn-1',
      index: 0,
      html: '<li>Row 1</li>',
      estimatedHeight: 120,
    })
    expect(result.turns[1]).toEqual({
      id: 'turn-2',
      index: 1,
      html: '<li>Row 2</li>',
      estimatedHeight: 200,
    })
    expect(result.playbackTurns).toHaveLength(1)
    expect(result.initialTurnIndex).toBe(0)
  })

  it('uses fallback height 80 when turn id missing from heightMap', () => {
    const turns = [{ id: 'unknown', index: 0 }]
    const result = buildExportPayload(turns, new Map(), new Map(), [], 0)
    expect(result.turns[0].estimatedHeight).toBe(80)
  })

  it('uses empty string when turn id missing from htmlMap', () => {
    const turns = [{ id: 'missing', index: 0 }]
    const result = buildExportPayload(turns, new Map(), new Map([['missing', 100]]), [], 0)
    expect(result.turns[0].html).toBe('')
  })

  it('preserves initialTurnIndex', () => {
    const result = buildExportPayload([], new Map(), new Map(), [], 42)
    expect(result.initialTurnIndex).toBe(42)
  })

  it('deep-copies playbackTurns units array', () => {
    const units = [{ id: 'u1', delayMs: 50 }]
    const playbackTurns: ReplayPlaybackTurnPlan[] = [
      { turnId: 't1', role: 'assistant', units },
    ]
    const result = buildExportPayload([], new Map(), new Map(), playbackTurns, 0)
    expect(result.playbackTurns[0].units).toEqual(units)
    expect(result.playbackTurns[0].units).not.toBe(units)
  })

  it('produces JSON-serializable output', () => {
    const turns = [{ id: 't1', index: 0 }]
    const htmlMap = new Map([['t1', '<li data-x="hello">content</li>']])
    const heightMap = new Map([['t1', 150]])
    const result = buildExportPayload(turns, htmlMap, heightMap, [], 0)

    const json = JSON.stringify(result)
    const parsed = JSON.parse(json)
    expect(parsed.turns[0].html).toBe('<li data-x="hello">content</li>')
    expect(parsed.turns[0].estimatedHeight).toBe(150)
  })
})

// ---------------------------------------------------------------------------
// estimateTurnHeight
// ---------------------------------------------------------------------------

describe('estimateTurnHeight', () => {
  // TURN_CHROME_PX = 24, TURN_HEADER_PX = 40  => base = 64

  it('returns base chrome height for a turn with no segments and no bookmark', () => {
    const layout = makeTurnLayout({ segments: [] })
    const height = estimateTurnHeight(layout, undefined, {})
    expect(height).toBe(64) // 24 + 40
  })

  it('adds bookmark chrome when bookmarkLabel is present', () => {
    const layout = makeTurnLayout({ segments: [] })
    const withBookmark = estimateTurnHeight(layout, 'Important', {})
    const without = estimateTurnHeight(layout, undefined, {})
    expect(withBookmark - without).toBe(54) // BOOKMARK_CHROME_PX
  })

  it('estimates height for a single inline block segment', () => {
    const blockMeta = makeBlockMeta({
      isDisclosure: false,
      estimatorMeta: makeEstimatorMeta({
        pretextEligible: true,
        measurableText: 'line1\nline2\nline3',
        lineHeightPx: 20,
      }),
    })
    const layout = makeTurnLayout({
      segments: [{ id: 'seg-1', type: 'block', block: { id: 'b1', type: 'text', text: 'hello' } }],
      blockMetaById: new Map([['b1', blockMeta]]),
    })

    const height = estimateTurnHeight(layout, undefined, {})
    // base(64) + 3 lines * 20px = 64 + 60 = 124
    expect(height).toBe(124)
  })

  it('adds segment gap between multiple segments', () => {
    const meta1 = makeBlockMeta({ isDisclosure: false })
    const meta2 = makeBlockMeta({ isDisclosure: false })
    const layout = makeTurnLayout({
      segments: [
        { id: 's1', type: 'block', block: { id: 'b1', type: 'text', text: '' } },
        { id: 's2', type: 'block', block: { id: 'b2', type: 'text', text: '' } },
      ],
      blockMetaById: new Map([['b1', meta1], ['b2', meta2]]),
    })

    const singleMeta = makeBlockMeta({ isDisclosure: false })
    const singleLayout = makeTurnLayout({
      segments: [{ id: 's1', type: 'block', block: { id: 'b1', type: 'text', text: '' } }],
      blockMetaById: new Map([['b1', singleMeta]]),
    })

    const twoSegHeight = estimateTurnHeight(layout, undefined, {})
    const oneSegHeight = estimateTurnHeight(singleLayout, undefined, {})
    // Second segment adds SEGMENT_GAP_PX (12) + its content height
    expect(twoSegHeight - oneSegHeight).toBeGreaterThanOrEqual(12)
  })

  it('uses collapsed disclosure height when block is disclosure and not open', () => {
    const blockMeta = makeBlockMeta({
      isDisclosure: true,
      defaultOpen: false,
      estimatorMeta: makeEstimatorMeta({ pretextEligible: true, measurableText: 'lots\nof\ntext', lineHeightPx: 20 }),
    })
    const layout = makeTurnLayout({
      segments: [{ id: 's1', type: 'block', block: { id: 'b1', type: 'thinking', text: 'lots\nof\ntext' } }],
      blockMetaById: new Map([['b1', blockMeta]]),
    })

    const height = estimateTurnHeight(layout, undefined, {})
    // base(64) + DISCLOSURE_SUMMARY_PX(32) = 96, NOT including full text
    expect(height).toBe(96)
  })

  it('expands thinking blocks when revealThinking is true', () => {
    const blockMeta = makeBlockMeta({
      isDisclosure: true,
      defaultOpen: false,
      estimatorMeta: makeEstimatorMeta({ pretextEligible: true, measurableText: 'line1\nline2', lineHeightPx: 20 }),
    })
    const layout = makeTurnLayout({
      segments: [{ id: 's1', type: 'block', block: { id: 'b1', type: 'thinking', text: 'thinking text' } }],
      blockMetaById: new Map([['b1', blockMeta]]),
    })

    const collapsed = estimateTurnHeight(layout, undefined, {})
    const expanded = estimateTurnHeight(layout, undefined, { revealThinking: true })
    // Expanded adds content + pad; collapsed is just summary
    expect(expanded).toBeGreaterThan(collapsed)
  })

  it('uses tool group summary height for grouped tool-run segments', () => {
    const toolRunMeta = makeToolRunMeta({ grouped: true })
    const layout = makeTurnLayout({
      segments: [{ id: 'run-1', type: 'tool-run', blocks: [
        { id: 't1', type: 'tool', name: 'Read', status: 'completed', input: '', output: '' },
        { id: 't2', type: 'tool', name: 'Read', status: 'completed', input: '', output: '' },
      ] }],
      toolRunMetaById: new Map([['run-1', toolRunMeta]]),
    })

    const height = estimateTurnHeight(layout, undefined, {})
    // base(64) + TOOL_GROUP_SUMMARY_PX(36) = 100
    expect(height).toBe(100)
  })

  it('estimates ungrouped tool-run blocks as individual disclosures', () => {
    const meta1 = makeBlockMeta({ isDisclosure: true, defaultOpen: false })
    const meta2 = makeBlockMeta({ isDisclosure: true, defaultOpen: false })
    const toolRunMeta = makeToolRunMeta({ grouped: false })
    const layout = makeTurnLayout({
      segments: [{ id: 'run-1', type: 'tool-run', blocks: [
        { id: 't1', type: 'tool', name: 'Read', status: 'completed', input: '', output: '' },
        { id: 't2', type: 'tool', name: 'Bash', status: 'completed', input: '', output: '' },
      ] }],
      blockMetaById: new Map([['t1', meta1], ['t2', meta2]]),
      toolRunMetaById: new Map([['run-1', toolRunMeta]]),
    })

    const height = estimateTurnHeight(layout, undefined, {})
    // base(64) + 2 * DISCLOSURE_SUMMARY_PX(32) + SEGMENT_GAP_PX(12) between blocks = 64 + 32 + 12 + 32 = 140
    expect(height).toBe(140)
  })

  it('returns a rounded integer', () => {
    const layout = makeTurnLayout({ segments: [] })
    const height = estimateTurnHeight(layout, undefined, {})
    expect(Number.isInteger(height)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// TURN_GAP_PX constant
// ---------------------------------------------------------------------------

describe('TURN_GAP_PX', () => {
  it('equals 12 matching the CSS gap: var(--space-3)', () => {
    expect(TURN_GAP_PX).toBe(12)
  })
})
