import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createCopilotProvider } from '../../server/providers/copilot'

describe('copilot provider', () => {
  it('scans files, indexes metadata/search text, and loads one session', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'copilot-provider-'))
    const sessionDir = join(homeDirectory, '.copilot', 'session-state', 'alpha-01-session')
    const eventsPath = join(sessionDir, 'events.jsonl')

    try {
      await mkdir(sessionDir, { recursive: true })
      await writeFile(join(sessionDir, 'workspace.yaml'), 'cwd: /Users/me/workspaces/demo-workspace\n', 'utf8')
      await writeFile(eventsPath, createCopilotEvents(), 'utf8')

      const provider = createCopilotProvider()
      const files = await provider.scan({ homeDir: homeDirectory })

      expect(files).toHaveLength(1)
      expect(files[0]?.path).toBe(eventsPath)
      expect(files[0]?.relativePath).toBe('alpha-01-session/events.jsonl')

      const indexed = await provider.index(files[0]!)
      expect(indexed.ref.project).toBe('demo-workspace')
      expect(indexed.ref.cwd).toBe('/Users/me/workspaces/demo-workspace')
      expect(indexed.searchDoc.metadataText).toContain('demo-workspace')
      expect(indexed.searchDoc.transcriptText).toContain('inspect this repo')

      const loaded = await provider.load(files[0]!)
      expect(loaded.ref.id).toBe(indexed.ref.id)
      expect(loaded.cwd).toBe('/Users/me/workspaces/demo-workspace')
      expect(loaded.turns.length).toBeGreaterThanOrEqual(2)
      expect(loaded.turns[0]?.userText).toBe('Can you inspect this repo?')
      const assistantTurn = loaded.turns.find((turn) =>
        turn.assistantBlocks.some((block) => block.kind === 'tool-call'),
      )
      const toolCall = assistantTurn?.assistantBlocks.find((block) => block.kind === 'tool-call')
      expect(toolCall).toMatchObject({
        kind: 'tool-call',
        name: 'Read',
        isError: false,
      })
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })
})

function createCopilotEvents(firstUserText = 'Can you inspect this repo?'): string {
  const events = [
    {
      type: 'user.message',
      timestamp: '2026-04-13T10:00:00.000Z',
      data: {
        content: firstUserText,
      },
    },
    {
      type: 'assistant.message',
      timestamp: '2026-04-13T10:00:02.000Z',
      data: {
        content: 'I checked and found files.',
        reasoningText: 'Scanning workspace.',
        toolRequests: [
          {
            name: 'view',
            toolCallId: 'tool-1',
            arguments: {
              path: '/Users/me/workspaces/demo-workspace/src',
            },
          },
        ],
      },
    },
    {
      type: 'tool.execution_complete',
      timestamp: '2026-04-13T10:00:04.000Z',
      data: {
        toolCallId: 'tool-1',
        success: true,
        result: 'index.ts\npackage.json',
      },
    },
    {
      type: 'user.message',
      timestamp: '2026-04-13T10:01:00.000Z',
      data: {
        content: 'Next step',
      },
    },
    {
      type: 'assistant.message',
      timestamp: '2026-04-13T10:01:02.000Z',
      data: {
        content: 'Done. Anything else?',
      },
    },
  ]

  return events.map((event) => JSON.stringify(event)).join('\n')
}
