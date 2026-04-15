import { describe, expect, it } from 'vitest'
import type { ReplayBlock } from '../../src/lib/api/contracts'
import {
  collectDefaultOpenIds,
  createPlaybackTurnsFromLayout,
  prepareTranscriptLayout,
} from '../../src/lib/replay/transcript-layout'

describe('transcript layout', () => {
  it('prepares segments, cached block html, and disclosure metadata once per turn', () => {
    const blocks: ReplayBlock[] = [
      {
        id: 'markdown-1',
        text: '## Heading\n\n- bullet',
        type: 'markdown',
      },
      {
        id: 'thinking-1',
        text: 'Private plan',
        type: 'thinking',
      },
      {
        id: 'tool-1',
        type: 'tool',
        name: 'Read',
        status: 'completed',
        input: { file_path: 'src/App.tsx' },
        output: 'const html = render()',
      },
      {
        id: 'tool-2',
        type: 'tool',
        name: 'Bash',
        status: 'failed',
        input: { command: 'exit 1' },
        output: 'failed',
        isError: true,
      },
    ]

    const layout = prepareTranscriptLayout([{ blocks, id: 'turn-1' }])
    const turnLayout = layout.turnLayoutById.get('turn-1')

    expect(turnLayout).toBeDefined()
    expect(turnLayout?.segments.map((segment) => segment.id)).toEqual([
      'markdown-1',
      'thinking-1',
      'tool-run:tool-1:tool-2',
    ])
    expect(turnLayout?.blockHtml.get('markdown-1')).toContain('<h2>Heading</h2>')
    expect(turnLayout?.blockHtml.get('thinking-1')).toContain('Private plan')
    expect(turnLayout?.blockHtml.get('tool-1')).toContain('src/App.tsx')
    expect(turnLayout?.summary).toBe('1 text, 1 thinking, 2 tool calls')
    expect(turnLayout?.previewText).toBe('## Heading - bullet')
    expect(turnLayout?.tone).toBe('tool')
    expect(turnLayout?.rowId).toBe('turn-1')
    expect(turnLayout?.playbackUnits.map((unit) => unit.id)).toEqual([
      'markdown-1',
      'thinking-1',
      'tool-1',
      'tool-2',
    ])
    expect(turnLayout?.estimator.segmentCount).toBe(3)
    expect(turnLayout?.estimator.unitCount).toBe(4)
    expect(turnLayout?.estimator.playbackDurationMs).toBeGreaterThan(0)
    expect(turnLayout?.blockMetaById.get('thinking-1')).toMatchObject({
      defaultOpen: false,
      isDisclosure: true,
      label: 'Thinking',
    })
    expect(turnLayout?.toolRunMetaById.get('tool-run:tool-1:tool-2')).toMatchObject({
      grouped: true,
      label: '2 tool calls',
      summaryMeta: 'Read, Bash · 1 failed',
    })
    expect(turnLayout?.disclosureIds).toEqual([
      'thinking-1',
      'tool-run:tool-1:tool-2',
      'tool-1',
      'tool-2',
    ])
    expect([...collectDefaultOpenIds(layout)]).toEqual([])
  })

  it('derives playback units from prepared segments without raw block traversal', () => {
    const layout = prepareTranscriptLayout([
      {
        blocks: [
          { id: 'assistant-text', text: 'Answer', type: 'text' },
          { id: 'assistant-tool', type: 'tool', name: 'Read', status: 'completed' },
        ],
        id: 'assistant-turn',
      },
      {
        blocks: [{ id: 'user-text', text: 'Question', type: 'text' }],
        id: 'user-turn',
      },
    ])

    const turns = createPlaybackTurnsFromLayout(
      [
        { id: 'assistant-turn', role: 'assistant' },
        { id: 'user-turn', role: 'user' },
      ],
      layout,
    )

    expect(turns[0]?.units.map((unit) => unit.id)).toEqual(['assistant-text', 'assistant-tool'])
    expect(turns[1]?.units).toEqual([])
    expect(turns[0]?.units.every((unit) => unit.delayMs > 0)).toBe(true)
  })

  it('attaches estimator metadata to each block layout', () => {
    const blocks: ReplayBlock[] = [
      { id: 'text-1', text: 'Hello world', type: 'text' },
      { id: 'md-1', text: 'Paragraph with **bold** text and a [link](https://example.com)', type: 'markdown' },
      { id: 'md-complex', text: 'Text\n\n```ts\ncode\n```', type: 'markdown' },
      { id: 'think-1', text: 'Reasoning', type: 'thinking' },
      { id: 'code-1', text: 'const x = 1', type: 'code' },
      { id: 'tool-1', type: 'tool', name: 'Bash', status: 'completed' },
    ]

    const layout = prepareTranscriptLayout([{ blocks, id: 'turn-1' }])
    const turnLayout = layout.turnLayoutById.get('turn-1')!

    // Plain text → pretext eligible, pre-wrap
    const textMeta = turnLayout.blockMetaById.get('text-1')!.estimatorMeta
    expect(textMeta.category).toBe('text')
    expect(textMeta.pretextEligible).toBe(true)
    expect(textMeta.whiteSpaceMode).toBe('pre-wrap')
    expect(textMeta.measurableText).toBe('Hello world')
    expect(textMeta.fontShorthand).toEqual(expect.any(String))
    expect(textMeta.lineHeightPx).toEqual(expect.any(Number))

    // Simple markdown → pretext eligible, normal whitespace
    const mdMeta = turnLayout.blockMetaById.get('md-1')!.estimatorMeta
    expect(mdMeta.category).toBe('markdown-simple')
    expect(mdMeta.pretextEligible).toBe(true)
    expect(mdMeta.whiteSpaceMode).toBe('normal')
    expect(mdMeta.measurableText).toContain('bold')
    expect(mdMeta.measurableText).toContain('link')

    // Complex markdown → fallback, still carries font/lineHeight
    const mdComplexMeta = turnLayout.blockMetaById.get('md-complex')!.estimatorMeta
    expect(mdComplexMeta.category).toBe('markdown-complex')
    expect(mdComplexMeta.pretextEligible).toBe(false)
    expect(mdComplexMeta.fallbackLineCount).toBeGreaterThan(0)
    expect(mdComplexMeta.fontShorthand).toEqual(expect.any(String))
    expect(mdComplexMeta.lineHeightPx).toEqual(expect.any(Number))

    // Thinking → pretext eligible, pre-wrap
    const thinkMeta = turnLayout.blockMetaById.get('think-1')!.estimatorMeta
    expect(thinkMeta.category).toBe('thinking')
    expect(thinkMeta.pretextEligible).toBe(true)
    expect(thinkMeta.whiteSpaceMode).toBe('pre-wrap')

    // Code → fallback with code font
    const codeMeta = turnLayout.blockMetaById.get('code-1')!.estimatorMeta
    expect(codeMeta.category).toBe('code')
    expect(codeMeta.pretextEligible).toBe(false)
    expect(codeMeta.fontShorthand).toEqual(expect.any(String))
    expect(codeMeta.lineHeightPx).toEqual(expect.any(Number))

    // Tool → fallback with disclosure font
    const toolMeta = turnLayout.blockMetaById.get('tool-1')!.estimatorMeta
    expect(toolMeta.category).toBe('tool')
    expect(toolMeta.pretextEligible).toBe(false)
    expect(toolMeta.fontShorthand).toEqual(expect.any(String))
    expect(toolMeta.lineHeightPx).toEqual(expect.any(Number))
  })
})
