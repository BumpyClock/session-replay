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
            text: 'Inspect export flow',
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
    expect(html).toContain('<article class="turn-panel is-active" data-turn-index="1" >')
  })

  it('applies revealThinking and keepTimestamps to rendered output', () => {
    const hiddenThinkingHtml = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      keepTimestamps: false,
      revealThinking: false,
    })

    expect(hiddenThinkingHtml).toContain('Thinking hidden for this export.')
    expect(hiddenThinkingHtml).not.toContain('Sensitive chain of thought')
    expect(hiddenThinkingHtml).not.toContain('2026-04-13T08:00:01.000Z')
    expect(hiddenThinkingHtml).not.toContain('<time>')

    const revealedThinkingHtml = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      keepTimestamps: true,
      revealThinking: true,
    })

    expect(revealedThinkingHtml).toContain('Sensitive chain of thought')
    expect(revealedThinkingHtml).toContain('2026-04-13T08:00:01.000Z')
    expect(revealedThinkingHtml).toContain('<time>2026-04-13T08:00:01.000Z</time>')
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
})
