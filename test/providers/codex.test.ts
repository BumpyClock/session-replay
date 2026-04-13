import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createCodexProvider,
  createSessionProvider,
  discoverCodexSessions,
  loadCodexSession,
  searchCodexSessions,
} from '../../server/providers/codex-provider'

describe('Codex provider', () => {
  let homeDirectory: string

  beforeEach(async () => {
    homeDirectory = await mkdtemp(join(tmpdir(), 'codex-provider-test-'))
  })

  afterEach(async () => {
    await rm(homeDirectory, { force: true, recursive: true })
  })

  it('scans, indexes, and loads codex sessions via catalog provider', async () => {
    const sessionPath = await writeLegacyCodexSession(homeDirectory)
    const provider = createSessionProvider()
    const files = await provider.scan({ homeDir: homeDirectory })

    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      source: 'codex',
      path: sessionPath,
      fingerprint: {
        path: sessionPath,
      },
    })

    const indexed = await provider.index(files[0]!)

    expect(indexed.ref.project).toBe('alpha')
    expect(indexed.ref.path).toBe(sessionPath)
    expect(indexed.ref.summary).toBe('List my backlog')
    expect(indexed.ref.stats).toEqual({
      turnCount: 2,
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolCallCount: 1,
    })
    expect(indexed.searchDoc.metadataText).toContain('alpha')
    expect(indexed.searchDoc.transcriptText).toContain('list my backlog')
    expect(indexed.searchDoc.transcriptText).toContain('i can do that.')
    expect(indexed.searchDoc.transcriptText).toContain('echo hello')

    const loaded = await provider.load(files[0]!)

    expect(loaded.ref).toMatchObject({
      id: indexed.ref.id,
      source: indexed.ref.source,
      path: indexed.ref.path,
      project: indexed.ref.project,
      title: indexed.ref.title,
      startedAt: indexed.ref.startedAt,
      updatedAt: indexed.ref.updatedAt,
    })
    expect(loaded.cwd).toBe('/Users/dev/projects/alpha')
    expect(loaded.turns).toHaveLength(1)
    expect(loaded.turns[0]?.userText).toBe('List my backlog')
    expect(loaded.turns[0]?.assistantBlocks[0]?.text).toBe('I can do that.')
    expect(loaded.turns[0]?.toolCalls[0]?.name).toBe('Bash')
    expect(loaded.turns[0]?.toolCalls[0]?.result).toBe('done')
  })

  it('keeps compat exports routed through catalog index/load flow', async () => {
    const sessionPath = await writeLegacyCodexSession(homeDirectory)
    const compatProvider = createCodexProvider({ homeDirectory })

    expect(await compatProvider.scan({ homeDir: homeDirectory })).toHaveLength(1)

    const sessions = await discoverCodexSessions(homeDirectory)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      project: 'alpha',
      path: sessionPath,
      summary: 'List my backlog',
    })

    const loaded = await loadCodexSession({
      sessionId: sessions[0]!.id,
      homeDirectory,
    })
    expect(loaded.project).toBe('alpha')
    expect(loaded.cwd).toBe('/Users/dev/projects/alpha')
    expect(loaded.turns).toHaveLength(2)
    expect(loaded.turns[0]?.blocks[0]?.text).toBe('List my backlog')
    expect(loaded.turns[1]?.toolCalls?.[0]?.name).toBe('Bash')

    const byProject = await searchCodexSessions(homeDirectory, { query: 'alpha', limit: 10 })
    expect(byProject).toHaveLength(1)
    expect(byProject[0]?.id).toBe(sessions[0]?.id)

    const byTranscript = await searchCodexSessions(homeDirectory, { query: 'backlog' })
    expect(byTranscript).toHaveLength(1)
    expect(byTranscript[0]?.id).toBe(sessions[0]?.id)
  })
})

async function writeLegacyCodexSession(homeDirectory: string): Promise<string> {
  const dayPath = join(homeDirectory, '.codex', 'sessions', '2026', '04', '13')
  await mkdir(dayPath, { recursive: true })

  const sessionPath = join(dayPath, 'rollout-2026-04-13T12-00-00-project-alpha.jsonl')
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

  return sessionPath
}
