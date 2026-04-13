import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/session-files/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../server/session-files/index.js')>(
    '../../server/session-files/index.js',
  )

  return {
    ...actual,
    readJsonLines: vi.fn(actual.readJsonLines),
  }
})

import { createClaudeCodeProvider } from '../../server/providers/claude-code.ts'
import * as sessionFiles from '../../server/session-files/index.js'

describe('claude-code catalog provider', () => {
  let homeDir: string
  let sessionPath: string

  beforeEach(async () => {
    vi.clearAllMocks()

    homeDir = await mkdtemp(join(tmpdir(), 'session-replay-claude-code-'))
    const projectDir = join(homeDir, '.claude', 'projects', '-Users-test-Workspace')
    await mkdir(projectDir, { recursive: true })
    sessionPath = join(projectDir, 'sample-session.jsonl')
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'Show me git status' },
          timestamp: '2026-01-01T10:00:00.000Z',
        }),
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
        '{not-json',
      ].join('\n'),
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(homeDir, { force: true, recursive: true })
  })

  it('scans without parsing, then indexes and loads same file via shared parser', async () => {
    const provider = createClaudeCodeProvider()
    const readJsonLinesMock = vi.mocked(sessionFiles.readJsonLines)

    const files = await provider.scan({ homeDir })

    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      source: 'claude-code',
      path: sessionPath,
      relativePath: '-Users-test-Workspace/sample-session.jsonl',
    })
    expect(files[0]?.fingerprint.size).toBeGreaterThan(0)
    expect(readJsonLinesMock).not.toHaveBeenCalled()

    const indexed = await provider.index(files[0]!)

    expect(readJsonLinesMock).toHaveBeenCalledTimes(1)
    expect(readJsonLinesMock).toHaveBeenLastCalledWith(sessionPath)
    expect(indexed.ref).toMatchObject({
      id: 'claude-code:-Users-test-Workspace/sample-session.jsonl',
      source: 'claude-code',
      path: sessionPath,
      project: 'test-Workspace',
      title: 'Show me git status',
      summary: 'Show me git status',
      stats: {
        turnCount: 3,
        userTurnCount: 2,
        assistantTurnCount: 1,
        toolCallCount: 1,
      },
    })
    expect(indexed.searchDoc.metadataText).toContain('show me git status')
    expect(indexed.searchDoc.transcriptText).toContain('running status command')
    expect(indexed.searchDoc.transcriptText).toContain('clean')
    expect(indexed.warnings).toHaveLength(1)

    const loaded = await provider.load(files[0]!)

    expect(readJsonLinesMock).toHaveBeenCalledTimes(2)
    expect(readJsonLinesMock.mock.calls.map(([filePath]) => filePath)).toEqual([
      sessionPath,
      sessionPath,
    ])
    expect(loaded.ref).toMatchObject({
      id: indexed.ref.id,
      source: 'claude-code',
      path: sessionPath,
      project: 'test-Workspace',
      title: 'Show me git status',
    })
    expect(loaded.warnings).toHaveLength(1)
    expect(loaded.turns).toHaveLength(2)
    expect(loaded.turns[0]?.userText).toBe('Show me git status')
    expect(loaded.turns[0]?.assistantBlocks.map((block) => block.text)).toEqual([
      'Inspecting repository state',
      'Running status command',
    ])
    expect(loaded.turns[0]?.toolCalls).toMatchObject([
      {
        id: 'tool-1',
        name: 'bash',
        input: { cmd: 'git status' },
        result: 'clean',
        isError: false,
      },
    ])
    expect(loaded.turns[1]?.userText).toBe('clean')
  })
})
