import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  discoverCopilotSessions,
  loadCopilotSession,
  searchCopilotSessions,
} from '../../server/providers/copilot'

describe('copilot provider', () => {
  it('discovers sessions, loads events, and filters by project', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'copilot-provider-'))
    const firstSessionDir = join(homeDirectory, '.copilot', 'session-state', 'alpha-01-session')
    const secondSessionDir = join(homeDirectory, '.copilot', 'session-state', 'beta-02-session')
    const firstEventsPath = join(firstSessionDir, 'events.jsonl')
    const secondEventsPath = join(secondSessionDir, 'events.jsonl')

    try {
      await mkdir(firstSessionDir, { recursive: true })
      await mkdir(secondSessionDir, { recursive: true })

      await writeFile(join(firstSessionDir, 'workspace.yaml'), 'cwd: /Users/me/workspaces/demo-workspace\n', 'utf8')
      await writeFile(firstEventsPath, createCopilotEvents(), 'utf8')
      await writeFile(secondEventsPath, createCopilotEvents('List top files'), 'utf8')

      const discovered = await discoverCopilotSessions(homeDirectory)
      expect(discovered).toHaveLength(2)

      const demo = discovered.find((session) => session.project === 'demo-workspace')
      expect(demo).toBeDefined()
      expect(demo?.project).toBe('demo-workspace')
      expect(demo?.cwd).toBe('/Users/me/workspaces/demo-workspace')

      const loaded = await loadCopilotSession({ homeDirectory, path: firstEventsPath })
      expect(loaded.source).toBe('copilot')
      expect(loaded.project).toBe('demo-workspace')
      expect(loaded.cwd).toBe('/Users/me/workspaces/demo-workspace')
      expect(loaded.title).toBe('Can you inspect this repo?')
      expect(loaded.turns.length).toBeGreaterThanOrEqual(2)
      expect(loaded.turns[0]?.role).toBe('turn')
      expect(loaded.turns[1]?.role).toBe('turn')
      const assistantTurn = loaded.turns.find((turn) => turn.toolCalls?.length)
      expect(assistantTurn?.toolCalls?.length).toBe(1)
      expect(assistantTurn?.toolCalls?.[0]?.name).toBe('Read')
      expect(assistantTurn?.toolCalls?.[0]?.isError).toBe(false)

      const searched = await searchCopilotSessions({
        homeDirectory,
        query: 'demo-workspace',
      })
      expect(searched).toHaveLength(1)
      expect(searched[0]?.project).toBe('demo-workspace')
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
    {
      type: 'session.shutdown',
      timestamp: '2026-04-13T10:02:00.000Z',
      data: {
        reason: 'done',
      },
    },
  ]

  return events.map((event) => JSON.stringify(event)).join('\n')
}
