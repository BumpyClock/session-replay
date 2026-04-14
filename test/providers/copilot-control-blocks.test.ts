import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCopilotProvider } from '../../server/providers/copilot'

describe('copilot control block ingest', () => {
  it('preserves transformedContent wrappers for shared control-block parsing', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'copilot-control-blocks-'))
    const sessionDir = join(homeDirectory, '.copilot', 'session-state', 'alpha-01-session')
    const eventsPath = join(sessionDir, 'events.jsonl')

    try {
      await mkdir(sessionDir, { recursive: true })
      await writeFile(join(sessionDir, 'workspace.yaml'), 'cwd: /Users/me/workspaces/demo-workspace\n', 'utf8')
      await writeFile(
        eventsPath,
        [
          JSON.stringify({
            type: 'user.message',
            timestamp: '2026-04-14T12:00:00.000Z',
            data: {
              content: 'fallback',
              transformedContent: [
                '<current_datetime>2026-04-14T12:00:00.000Z</current_datetime>',
                '<reminder><todo_status>Todos: 6 pending</todo_status></reminder>',
                'Inspect control blocks.',
              ].join('\n'),
            },
          }),
        ].join('\n'),
        'utf8',
      )

      const provider = createCopilotProvider()
      const files = await provider.scan({ homeDir: homeDirectory })
      const loaded = await provider.load(files[0]!)

      expect(loaded.turns[0]?.userText).toContain('<current_datetime>')
      expect(loaded.turns[0]?.userText).toContain('<reminder>')
      expect(loaded.turns[0]?.userText).toContain('Inspect control blocks.')
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })
})
