import { describe, expect, it } from 'vitest'
import type { ReplayBlock, ReplayTurn } from '../../src/lib/api/contracts'
import { renderReplayBlockHtml, renderReplayTurnBodyHtml } from '../../src/lib/markdown'

function createTurn(text: string): ReplayTurn {
  return {
    blocks: [
      {
        id: 'block-1',
        text,
        type: 'markdown',
      },
    ],
    id: 'turn-1',
    index: 0,
    role: 'assistant',
  }
}

describe('renderReplayTurnBodyHtml', () => {
  it('renders heading, list, code, and link markdown into html', () => {
    const html = renderReplayTurnBodyHtml(
      createTurn(
        '## Heading\n\n- item one\n- item two\n\n```ts\nconst answer = 42\n```\n\n[Docs](https://example.com/docs)',
      ),
    )

    expect(html).toContain('<h2>Heading</h2>')
    expect(html).toContain('<li>item one</li>')
    expect(html).toContain('<pre><code class="language-ts">')
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  it('escapes raw html from transcript content', () => {
    const html = renderReplayTurnBodyHtml(createTurn('<div class="evil">owned</div>'))

    expect(html).not.toContain('<div class="evil">owned</div>')
    expect(html).toContain('&lt;div class=&quot;evil&quot;&gt;owned&lt;/div&gt;')
  })

  it('renders tool blocks with input and output sections', () => {
    const html = renderReplayBlockHtml({
      id: 'tool-1',
      type: 'tool',
      name: 'Read',
      status: 'completed',
      input: { file_path: 'src/App.tsx' },
      output: 'console.log("hi")',
    })

    expect(html).toContain('Read · completed')
    expect(html).toContain('Input')
    expect(html).toContain('Result')
    expect(html).toContain('src/App.tsx')
  })

  it('keeps plain text blocks plain instead of markdown-rendering them', () => {
    const block: ReplayBlock = {
      id: 'block-plain',
      text: 'Literal **stars**\n<script>alert(1)</script>',
      type: 'text',
    }

    const html = renderReplayBlockHtml(block)

    expect(html).toContain('<div class="replay-text-render">Literal **stars**')
    expect(html).not.toContain('<strong>stars</strong>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('collapses skill context scaffolding into rich replay metadata blocks', () => {
    const html = renderReplayTurnBodyHtml(
      createTurn(
        [
          'Plan next step.',
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
      ),
    )

    expect(html).toContain('Plan next step.')
    expect(html).toContain('Skill context')
    expect(html).toContain('ux-designer')
    expect(html).toContain('2 refs')
    expect(html).not.toContain('&lt;skill-context')
  })

  it('collapses AGENTS instruction bundles into workspace instruction cards', () => {
    const html = renderReplayTurnBodyHtml(
      createTurn(
        [
          'Loaded AGENTS.md',
          '',
          '## Communication style',
          '- Use telegraph style',
          '',
          '## Agent Protocols',
          '- Use tasque',
          '',
          '## Priorities',
          '- Fix root cause',
        ].join('\n'),
      ),
    )

    expect(html).toContain('Workspace instructions')
    expect(html).toContain('AGENTS.md')
    expect(html).not.toContain('## Communication style')
  })

  it('collapses Codex permissions scaffolding into a runtime permissions card', () => {
    const html = renderReplayTurnBodyHtml(
      createTurn(
        [
          '<permissions instructions>',
          'Filesystem sandboxing defines which files can be read or written. sandbox_mode is danger-full-access: No filesystem sandboxing - all commands are permitted. Network access is enabled.',
          'Approval policy is currently never. Do not provide the sandbox_permissions for any reason, commands will be rejected.',
          '</permissions instructions>',
        ].join('\n'),
      ),
    )

    expect(html).toContain('Runtime permissions')
    expect(html).toContain('danger-full-access')
    expect(html).toContain('never')
    expect(html).toContain('Raw transcript')
  })

  it('removes current_datetime scaffolding while preserving surrounding text', () => {
    const html = renderReplayTurnBodyHtml(
      createTurn(
        [
          '<current_datetime>2026-04-14T22:21:40.311Z</current_datetime>',
          '',
          'ok lets make these updates then.',
        ].join('\n'),
      ),
    )

    expect(html).toContain('ok lets make these updates then.')
    expect(html).not.toContain('2026-04-14T22:21:40.311Z')
    expect(html).not.toContain('&lt;current_datetime')
  })

  it('collapses subagent notifications into agent activity cards', () => {
    const html = renderReplayTurnBodyHtml(
      createTurn(
        '<subagent_notification>{"agent_id":"agent-1","agent_path":"/tmp/subagents/agent-1","status":{"completed":"Findings ready"}}</subagent_notification>',
      ),
    )

    expect(html).toContain('Sub-agent')
    expect(html).toContain('completed')
    expect(html).toContain('Findings ready')
    expect(html).toContain('Raw transcript')
  })
})
