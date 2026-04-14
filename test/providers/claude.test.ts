import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverClaudeSessions, loadClaudeSession, searchClaudeSessions } from '../../server/providers/claude'

describe('Claude provider', () => {
  let homeDir: string
  let sessionPath: string

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'session-replay-claude-'))
    const projectDir = join(
      homeDir,
      '.claude',
      'projects',
      '-Users-test-Workspace',
    )
    await mkdir(projectDir, { recursive: true })
    sessionPath = join(projectDir, 'sample-session.jsonl')
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: 'Show me git status',
          },
          timestamp: '2026-01-01T10:00:00.000Z',
        }),
        '\n',
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Inspecting repository state' },
              { type: 'text', text: 'Running status command' },
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'bash',
                input: { cmd: 'git status' },
              },
            ],
          },
          timestamp: '2026-01-01T10:00:01.000Z',
        }),
        '\n',
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-1',
                content: 'clean',
              },
            ],
          },
          timestamp: '2026-01-01T10:00:02.000Z',
        }),
      ].join('\n'),
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(homeDir, { force: true, recursive: true })
  })

  it('discovers, searches, and loads a Claude session transcript', async () => {
    const sessions = await discoverClaudeSessions(homeDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toBeDefined()
    expect(sessions[0]?.path).toBe(sessionPath)
    expect(sessions[0]?.project).toContain('Users')

    const titleSearch = await searchClaudeSessions('sample-session', homeDir)
    expect(titleSearch).toHaveLength(1)
    expect(titleSearch[0]?.id).toBe(sessions[0]?.id)

    const pathSearch = await searchClaudeSessions(basename(sessionPath), homeDir)
    expect(pathSearch).toHaveLength(1)

    const loaded = await loadClaudeSession({ sessionId: 'sample-session' }, homeDir)
    expect(loaded.id).toBe(sessions[0]?.id)
    expect(loaded.turns).toHaveLength(2)
    expect(loaded.turns[0]?.role).toBe('user')
    expect(loaded.turns[1]?.role).toBe('assistant')
    expect(loaded.turns[1]?.blocks).toHaveLength(3)
    expect(loaded.turns[1]?.blocks.map((block) => block.type)).toEqual(['thinking', 'markdown', 'tool'])
    expect(loaded.turns[1]?.blocks[2]).toMatchObject({
      name: 'bash',
      output: 'clean',
      type: 'tool',
    })
  })
})
