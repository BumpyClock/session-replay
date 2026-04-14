import { describe, expect, it } from 'vitest'
import type { MaterializedReplaySession } from '../../src/lib/api/contracts'
import { renderReplayDocument } from '../../server/export/render-replay-document'

function createFixtureSession(): MaterializedReplaySession {
  return {
    bookmarks: [
      {
        id: 'bookmark:turn-2',
        label: 'Thinking step',
        turnIndex: 1,
      },
      {
        id: 'bookmark:turn-3',
        label: 'Answer',
        turnIndex: 2,
      },
    ],
    id: 'session-export',
    source: 'codex',
    startedAt: '2026-04-13T08:00:00.000Z',
    title: 'Export replay',
    turns: [
      {
        blocks: [
          {
            id: 'turn-1-user',
            text: [
              'Inspect export flow',
              '',
              '<skill-context name="ux-designer">',
              'Base directory for this skill: /skills/ux-designer',
              '',
              'Related files (use view tool to read):',
              '  - /skills/ux-designer/design-direction.md',
              '  - /skills/ux-designer/interaction-visual-clarity.md',
              '',
              '---',
              'name: ux-designer',
              'description: Create UX design documentation, layout specs, interaction flows, and style guides.',
              'context: fork',
              '---',
              '',
              '# Core Workflow',
              '',
              '## Design Direction',
              '</skill-context>',
            ].join('\n'),
            type: 'text',
          },
        ],
        id: 'turn-1',
        index: 0,
        role: 'user',
        timestamp: '2026-04-13T08:00:01.000Z',
      },
      {
        blocks: [
          {
            id: 'turn-2-thinking',
            text: 'Sensitive chain of thought',
            type: 'thinking',
          },
        ],
        id: 'turn-2',
        index: 1,
        role: 'assistant',
        timestamp: '2026-04-13T08:00:02.000Z',
      },
      {
        blocks: [
          {
            id: 'turn-3-answer',
            text: 'Fixed export mapping.',
            type: 'markdown',
          },
          {
            id: 'turn-3-tool',
            type: 'tool',
            name: 'Read',
            status: 'completed',
            input: { file_path: 'src/App.tsx' },
            output: 'const html = render()',
          },
        ],
        id: 'turn-3',
        index: 2,
        role: 'assistant',
        timestamp: '2026-04-13T08:00:03.000Z',
      },
    ],
    updatedAt: '2026-04-13T08:05:00.000Z',
  }
}

describe('renderReplayDocument', () => {
  it('renumbers filtered turns and bookmark targets after export filtering', () => {
    const html = renderReplayDocument(createFixtureSession(), {
      includeThinking: false,
      initialTurnIndex: 2,
    })

    expect(html).toContain('data-turn-index="0"')
    expect(html).toContain('data-turn-index="1"')
    expect(html).not.toContain('data-turn-index="2"')
    expect(html).not.toContain('Thinking step')
    expect(html).toContain('<button class="bookmark" data-turn-index="1" type="button">Answer</button>')
    expect(html).toContain('value="1"')
    expect(html).toContain('<article class="turn-panel turn-panel--tool is-active" data-turn-index="1" >')
  })

  it('applies revealThinking and keepTimestamps to rendered output', () => {
    const hiddenThinkingHtml = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      keepTimestamps: false,
      revealThinking: false,
    })

    expect(hiddenThinkingHtml).toContain('Sensitive chain of thought')
    expect(hiddenThinkingHtml).toContain('id="toggle-thinking" type="checkbox"')
    expect(hiddenThinkingHtml).not.toContain('id="toggle-thinking" type="checkbox" checked')
    expect(hiddenThinkingHtml).not.toContain('2026-04-13T08:00:01.000Z')
    expect(hiddenThinkingHtml).not.toContain('<time>')
    expect(hiddenThinkingHtml).toContain('Tool: Read')
    expect(hiddenThinkingHtml).toContain('data-action="expand-all"')
    expect(hiddenThinkingHtml).toContain('data-action="collapse-all"')
    expect(hiddenThinkingHtml).toContain('completed · src/App.tsx')
    expect(hiddenThinkingHtml).toContain('turn-panel turn-panel--tool')
    expect(hiddenThinkingHtml).toContain('turn-bookmark-note')
    expect(hiddenThinkingHtml).toContain('Answer')

    const revealedThinkingHtml = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      keepTimestamps: true,
      revealThinking: true,
    })

    expect(revealedThinkingHtml).toContain('Sensitive chain of thought')
    expect(revealedThinkingHtml).toContain('id="toggle-thinking" type="checkbox" checked')
    expect(revealedThinkingHtml).toContain('2026-04-13T08:00:01.000Z')
    expect(revealedThinkingHtml).toContain('<time class="turn-header-time">2026-04-13T08:00:01.000Z</time>')
    expect(revealedThinkingHtml).toContain('<details class="turn-block turn-block--tool" data-replay-kind="tool">')
    expect(revealedThinkingHtml).toContain('Skill context')
    expect(revealedThinkingHtml).toContain('ux-designer')
    expect(revealedThinkingHtml).not.toContain('&lt;skill-context')
    expect(revealedThinkingHtml).toContain('turn-item-bookmark')
  })

  it('filters tool blocks when export disables tool call rendering', () => {
    const html = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      includeToolCalls: false,
    })

    expect(html).not.toContain('Tool: Read')
    expect(html).not.toContain('const html = render()')
  })

  it('renders markdown blocks and escapes raw html in export output', () => {
    const session = createFixtureSession()
    session.turns[2] = {
      ...session.turns[2],
      blocks: [
        {
          id: 'turn-3-answer',
          text: '## Heading\n\n- item one\n\n<div class="evil">owned</div>',
          type: 'markdown',
        },
      ],
    }

    const html = renderReplayDocument(session, {
      includeThinking: true,
    })

    expect(html).toContain('<h2>Heading</h2>')
    expect(html).toContain('<li>item one</li>')
    expect(html).not.toContain('<div class="evil">owned</div>')
    expect(html).toContain('&lt;div class=&quot;evil&quot;&gt;owned&lt;/div&gt;')
  })

  it('groups long consecutive tool runs behind a shared disclosure', () => {
    const session = createFixtureSession()
    session.turns[2] = {
      ...session.turns[2],
      blocks: Array.from({ length: 5 }, (_, index) => ({
        id: `turn-3-tool-${index}`,
        type: 'tool' as const,
        name: index % 2 === 0 ? 'Read' : 'Bash',
        status: index === 4 ? 'failed' : 'completed',
        input: index % 2 === 0 ? { file_path: `src/file-${index}.ts` } : { command: `echo ${index}` },
        output: `result-${index}`,
        isError: index === 4,
      })),
    }

    const html = renderReplayDocument(session, {
      includeThinking: false,
      includeToolCalls: true,
    })

    expect(html).toContain('class="turn-tool-group" data-replay-kind="tool"')
    expect(html).toContain('>5 tool calls<')
    expect(html).toContain('Read, Bash')
    expect(html).toContain('1 failed')
  })
})
