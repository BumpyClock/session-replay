import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createCodexProvider,
  discoverCodexSessions,
  loadCodexSession,
  searchCodexSessions,
} from '../../server/providers/codex-provider'

describe('codex catalog provider', () => {
  let homeDirectory: string
  let sessionPath: string

  beforeEach(async () => {
    homeDirectory = await mkdtemp(join(tmpdir(), 'codex-provider-test-'))
    const dayPath = join(homeDirectory, '.codex', 'sessions', '2026', '04', '13')
    await mkdir(dayPath, { recursive: true })

    sessionPath = join(dayPath, 'rollout-2026-04-13T12-00-00-project-alpha.jsonl')
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-04-13T12:00:00.000Z',
          payload: {
            cwd: '/Users/dev/projects/alpha',
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-04-13T12:00:01.000Z',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-04-13T12:00:02.000Z',
          payload: {
            type: 'user_message',
            message: '## My request for Codex:\nList my backlog',
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-13T12:00:03.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'I can do that.' }],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-13T12:00:04.000Z',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            call_id: 'call-1',
            arguments: JSON.stringify({ cmd: 'echo hello' }),
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-13T12:00:05.000Z',
          payload: {
            type: 'function_call_output',
            call_id: 'call-1',
            output: 'done',
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'task_complete' },
        }),
      ].join('\n'),
    )
  })

  afterEach(async () => {
    await rm(homeDirectory, { force: true, recursive: true })
  })

  it('scans, indexes, and loads one codex transcript', async () => {
    const provider = createCodexProvider()
    const files = await provider.scan({ homeDir: homeDirectory })

    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe(sessionPath)
    expect(files[0]?.fingerprint.size).toBeGreaterThan(0)

    const indexed = await provider.index(files[0]!)
    expect(indexed.ref.project).toBe('alpha')
    expect(indexed.ref.stats?.turnCount).toBe(3)
    expect(indexed.searchDoc.transcriptText).toContain('list my backlog')

    const loaded = await provider.load(files[0]!)
    expect(loaded.cwd).toBe('/Users/dev/projects/alpha')
    expect(loaded.turns).toHaveLength(2)
    expect(loaded.turns[0]?.systemBlocks[0]?.text).toContain('<session_meta>')
    expect(loaded.turns[1]?.assistantBlocks[0]?.text).toBe('I can do that.')
    expect(loaded.turns[1]?.assistantBlocks[1]).toMatchObject({
      kind: 'tool-call',
      name: 'Bash',
      result: 'done',
    })
  })

  it('keeps helper exports routed through the catalog path', async () => {
    const sessions = await discoverCodexSessions(homeDirectory)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.project).toBe('alpha')

    const loaded = await loadCodexSession({ sessionId: sessions[0]?.id, homeDirectory })
    expect(loaded.project).toBe('alpha')
    expect(loaded.turns[0]?.role).toBe('system')
    expect(loaded.turns[1]?.blocks[0]?.text).toBe('List my backlog')

    const searchResults = await searchCodexSessions(homeDirectory, { query: 'backlog', limit: 10 })
    expect(searchResults).toHaveLength(1)
    expect(searchResults[0]?.path).toBe(sessionPath)
  })
})
