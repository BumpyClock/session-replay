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

import {
  createClaudeCodeProvider,
  createSessionProvider,
} from '../../server/providers/claude-code.ts'
import * as sessionFiles from '../../server/session-files/index.js'

describe('claude-code catalog provider', () => {
  let homeDir: string
  let validSessionPath: string
  let invalidSessionPath: string

  beforeEach(async () => {
    vi.clearAllMocks()

    homeDir = await mkdtemp(join(tmpdir(), 'session-replay-claude-code-'))
    const projectDir = join(homeDir, '.claude', 'projects', '-Users-test-Workspace')
    await mkdir(projectDir, { recursive: true })

    validSessionPath = join(projectDir, 'sample-session.jsonl')
    invalidSessionPath = join(projectDir, 'broken-session.jsonl')

    await writeFile(
      validSessionPath,
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
      ].join('\n'),
      'utf8',
    )

    await writeFile(invalidSessionPath, '{not-json\n', 'utf8')
  })

  afterEach(async () => {
    await rm(homeDir, { force: true, recursive: true })
  })

  it('scans without parsing, then indexes and loads one session', async () => {
    const provider = createSessionProvider()
    const legacyProvider = createClaudeCodeProvider()
    const readJsonLinesMock = vi.mocked(sessionFiles.readJsonLines)

    const files = await provider.scan({ homeDir })

    expect(files.map((file) => file.path).sort()).toEqual([invalidSessionPath, validSessionPath].sort())
    expect(files.find((file) => file.path === validSessionPath)).toMatchObject({
      source: 'claude-code',
      path: validSessionPath,
    })
    expect(readJsonLinesMock).not.toHaveBeenCalled()

    const validFile = files.find((file) => file.path === validSessionPath)
    expect(validFile).toBeDefined()

    const indexed = await provider.index(validFile!)

    expect(readJsonLinesMock).toHaveBeenCalledTimes(1)
    expect(readJsonLinesMock).toHaveBeenLastCalledWith(validSessionPath)
    expect(indexed.ref).toMatchObject({
      id: 'claude-code:-Users-test-Workspace/sample-session.jsonl',
      source: 'claude-code',
      path: validSessionPath,
      project: 'test-Workspace',
      title: 'Show me git status',
      summary: 'Show me git status',
      stats: {
        turnCount: 2,
        userTurnCount: 1,
        assistantTurnCount: 1,
        toolCallCount: 1,
      },
    })
    expect(indexed.searchDoc.metadataText).toContain('show me git status')
    expect(indexed.searchDoc.transcriptText).toContain('running status command')
    expect(indexed.searchDoc.transcriptText).toContain('clean')
    expect(indexed.warnings).toEqual([])

    const loaded = await provider.load(validFile!)

    expect(readJsonLinesMock).toHaveBeenCalledTimes(2)
    expect(loaded.ref).toMatchObject({
      id: indexed.ref.id,
      source: 'claude-code',
      path: validSessionPath,
      project: 'test-Workspace',
      title: 'Show me git status',
    })
    expect(loaded.warnings).toEqual([])
    expect(loaded.turns).toHaveLength(1)
    expect(loaded.turns[0]?.userText).toBe('Show me git status')
    expect(loaded.turns[0]?.assistantBlocks.map((block) => block.kind)).toEqual([
      'thinking',
      'text',
      'tool-call',
    ])
    expect(
      loaded.turns[0]?.assistantBlocks
        .filter((block) => block.kind !== 'tool-call')
        .map((block) => block.text),
    ).toEqual([
      'Inspecting repository state',
      'Running status command',
    ])
    expect(loaded.turns[0]?.assistantBlocks[2]).toMatchObject({
      id: 'tool-1',
      kind: 'tool-call',
      name: 'bash',
      input: { cmd: 'git status' },
      result: 'clean',
      isError: false,
    })

    const legacyLoaded = await legacyProvider.load(validFile!)

    expect(readJsonLinesMock).toHaveBeenCalledTimes(3)
    expect(legacyLoaded.ref.id).toBe(loaded.ref.id)
    expect(legacyLoaded.turns[0]?.assistantBlocks[2]).toMatchObject({
      kind: 'tool-call',
      result: 'clean',
    })
  })
})
