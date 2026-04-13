import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionSource } from '../../server/providers/index'

function createFixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'session-replay-providers-'))

  const claudeDir = join(home, '.claude', 'projects', '-Users-test-alpha')
  mkdirSync(join(claudeDir, 'subagents'), { recursive: true })
  writeFileSync(
    join(claudeDir, 'session-a.jsonl'),
    [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Hello Claude' },
        timestamp: '2026-04-12T10:00:00Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi there' }],
        },
        timestamp: '2026-04-12T10:00:01Z',
      }),
    ].join('\n'),
  )
  writeFileSync(
    join(claudeDir, 'subagents', 'session-b.jsonl'),
    [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Nested subagent run' },
        timestamp: '2026-04-12T10:05:00Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Handled by subagent' }],
        },
        timestamp: '2026-04-12T10:05:01Z',
      }),
    ].join('\n'),
  )

  const codexDir = join(home, '.codex', 'sessions', '2026', '04', '12')
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(
    join(codexDir, 'rollout-2026-04-12T10-10-00-test.jsonl'),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-12T10:10:00Z',
        payload: { cwd: '/tmp/codex-project' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-12T10:10:01Z',
        payload: { type: 'task_started', turn_id: 'turn-1' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-12T10:10:02Z',
        payload: {
          type: 'user_message',
          message: '## My request for Codex:\nlist files here\n',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-12T10:10:03Z',
        payload: {
          type: 'message',
          phase: 'commentary',
          content: [{ text: 'Checking files.' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-12T10:10:04Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"ls","workdir":"/tmp/codex-project"}',
          call_id: 'call-1',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-12T10:10:05Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'Chunk ID: 1\nOutput:\nfile-a\nfile-b\n',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-12T10:10:06Z',
        payload: {
          type: 'message',
          phase: 'final_answer',
          content: [{ text: 'Found files.' }],
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-12T10:10:07Z',
        payload: { type: 'task_complete', turn_id: 'turn-1' },
      }),
    ].join('\n'),
  )

  const copilotDir = join(home, '.copilot', 'session-state', 'copilot-1')
  mkdirSync(copilotDir, { recursive: true })
  writeFileSync(join(copilotDir, 'workspace.yaml'), 'cwd: C:\\Users\\test\\copilot-project\n')
  writeFileSync(
    join(copilotDir, 'events.jsonl'),
    [
      JSON.stringify({
        type: 'session.start',
        timestamp: '2026-04-12T11:00:00.000Z',
        data: {
          context: { cwd: 'C:\\Users\\test\\copilot-project' },
        },
      }),
      JSON.stringify({
        type: 'user.message',
        timestamp: '2026-04-12T11:00:10.000Z',
        data: {
          content: 'read index.ts',
          transformedContent:
            '<current_datetime>2026-04-12T11:00:10.000Z</current_datetime>\n\nread index.ts\n\n<reminder>ignore</reminder>',
        },
      }),
      JSON.stringify({
        type: 'assistant.message',
        timestamp: '2026-04-12T11:00:11.000Z',
        data: {
          reasoningText: 'Need read tool.',
          content: '',
          toolRequests: [
            {
              toolCallId: 'tool-1',
              name: 'view',
              arguments: { path: 'C:\\Users\\test\\copilot-project\\src\\index.ts' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'tool.execution_complete',
        timestamp: '2026-04-12T11:00:12.000Z',
        data: {
          toolCallId: 'tool-1',
          success: true,
          result: { detailedContent: 'export const hi = "hey"\n' },
        },
      }),
      JSON.stringify({
        type: 'assistant.message',
        timestamp: '2026-04-12T11:00:13.000Z',
        data: {
          content: 'Read complete.',
          toolRequests: [],
        },
      }),
    ].join('\n'),
  )

  const cursorDir = join(
    home,
    '.cursor',
    'projects',
    '-Users-test-ble-app',
    'agent-transcripts',
    'cursor-1',
  )
  mkdirSync(cursorDir, { recursive: true })
  writeFileSync(
    join(cursorDir, 'transcript.jsonl'),
    [
      JSON.stringify({
        role: 'user',
        message: {
          content: [{ type: 'text', text: '<user_query>\nscan for ble devices\n</user_query>' }],
        },
      }),
      JSON.stringify({
        role: 'assistant',
        message: { content: [{ type: 'text', text: 'Planning scan.' }] },
      }),
      JSON.stringify({
        role: 'assistant',
        message: { content: [{ type: 'text', text: 'Found two devices.' }] },
      }),
    ].join('\n'),
  )

  const geminiDir = join(home, '.gemini', 'tmp', 'abc123456789', 'chats')
  mkdirSync(geminiDir, { recursive: true })
  writeFileSync(
    join(geminiDir, 'chat-1.json'),
    JSON.stringify(
      {
        sessionId: 'gem-1',
        projectHash: 'abc123456789',
        startTime: '2026-04-12T12:00:00.000Z',
        lastUpdated: '2026-04-12T12:01:00.000Z',
        messages: [
          {
            type: 'user',
            timestamp: '2026-04-12T12:00:00.000Z',
            content: 'Run a failing command',
          },
          {
            type: 'gemini',
            timestamp: '2026-04-12T12:00:05.000Z',
            content: 'The command failed.',
            thoughts: [],
            toolCalls: [
              {
                id: 'run-1',
                name: 'run_shell_command',
                args: { command: 'cat missing.txt' },
                status: 'error',
                timestamp: '2026-04-12T12:00:04.000Z',
                result: [
                  {
                    functionResponse: {
                      response: {
                        output: '',
                        error: 'cat: missing.txt: No such file or directory',
                        exitCode: 1,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  )

  return home
}

describe('createSessionSource', () => {
  it('lists sessions across immutable provider roots', async () => {
    const home = createFixtureHome()
    const sessionSource = createSessionSource({ homeDirectory: home })

    const sessions = await sessionSource.listSessions()

    expect(sessions.map((session) => session.source).sort()).toEqual([
      'claude-code',
      'claude-code',
      'codex',
      'copilot',
      'cursor',
      'gemini',
    ])
    expect(sessions.find((session) => session.source === 'cursor')?.project).toBe('ble-app')
    expect(sessions.find((session) => session.source === 'codex')?.project).toBe('codex-project')
  })

  it('loads sessions by path and materializes replay turns', async () => {
    const home = createFixtureHome()
    const sessionSource = createSessionSource({ homeDirectory: home })
    const sessions = await sessionSource.listSessions()
    const claudeSession = sessions.find((session) => session.path.endsWith('session-a.jsonl'))

    expect(claudeSession).toBeDefined()

    const result = await sessionSource.loadSession({ path: claudeSession!.path })

    expect(result.turns).toHaveLength(2)
    expect(result.turns[0]?.role).toBe('user')
    expect(result.turns[1]?.role).toBe('assistant')
    expect(result.turns[1]?.blocks[0]?.text).toBe('Hi there')
  })

  it('loads codex sessions by session id and normalizes tool calls', async () => {
    const home = createFixtureHome()
    const sessionSource = createSessionSource({ homeDirectory: home })
    const sessions = await sessionSource.listSessions()
    const codexSession = sessions.find((session) => session.source === 'codex')

    expect(codexSession).toBeDefined()

    const result = await sessionSource.loadSession({ sessionId: codexSession!.id })
    const assistantTurn = result.turns.find((turn) => turn.role === 'assistant')

    expect(assistantTurn?.toolCalls?.[0]?.name).toBe('Bash')
    expect(assistantTurn?.toolCalls?.[0]?.input).toContain('cd /tmp/codex-project && ls')
    expect(assistantTurn?.toolCalls?.[0]?.output).toBe('file-a\nfile-b')
  })

  it('searches transcript content, not only metadata', async () => {
    const home = createFixtureHome()
    const sessionSource = createSessionSource({ homeDirectory: home })

    const results = await sessionSource.searchSessions({
      query: 'failing command',
      limit: 10,
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.source).toBe('gemini')
  })

  it('returns empty session lists when provider roots are missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'session-replay-empty-'))
    const sessionSource = createSessionSource({ homeDirectory: home })

    await expect(sessionSource.listSessions()).resolves.toEqual([])
    expect(sessionSource.listCatalogWarnings?.()).toEqual([])
    await expect(
      sessionSource.searchSessions({ query: 'anything', limit: 5 }),
    ).resolves.toEqual([])
  })
})
