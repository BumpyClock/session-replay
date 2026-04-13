import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createGeminiProvider } from '../../server/providers/gemini'

describe('gemini provider', () => {
  it('scans chat json files, indexes text, and loads one session', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'gemini-provider-'))
    const chatDir = join(homeDirectory, '.gemini', 'tmp', 'abc123456789', 'chats')
    const chatPath = join(chatDir, 'chat-1.json')

    try {
      await mkdir(chatDir, { recursive: true })
      await writeFile(
        chatPath,
        JSON.stringify(
          {
            projectHash: 'abc123456789',
            startTime: '2026-04-12T12:00:00.000Z',
            lastUpdated: '2026-04-12T12:01:00.000Z',
            messages: [
              {
                type: 'user',
                timestamp: '2026-04-12T12:00:00.000Z',
                content: [
                  {
                    text: 'Run a failing command',
                  },
                ],
              },
              {
                type: 'gemini',
                timestamp: '2026-04-12T12:00:05.000Z',
                content: 'The command failed.',
                thoughts: [
                  {
                    subject: 'Command plan',
                    description: 'Need inspect shell failure',
                    timestamp: '2026-04-12T12:00:04.000Z',
                  },
                ],
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
        'utf8',
      )

      const provider = createGeminiProvider()
      const files = await provider.scan({ homeDir: homeDirectory })

      expect(files).toHaveLength(1)
      expect(files[0]?.relativePath).toBe('abc123456789/chats/chat-1.json')

      const indexed = await provider.index(files[0]!)
      expect(indexed.ref.project).toBe('abc123456789')
      expect(indexed.searchDoc.transcriptText).toContain('failing command')

      const loaded = await provider.load(files[0]!)
      expect(loaded.ref.id).toBe(indexed.ref.id)
      expect(loaded.turns).toHaveLength(1)
      expect(loaded.turns[0]?.userText).toBe('Run a failing command')
      expect(loaded.turns[0]?.assistantBlocks[0]?.kind).toBe('thinking')
      expect(loaded.turns[0]?.toolCalls[0]?.name).toBe('Bash')
      expect(loaded.turns[0]?.toolCalls[0]?.isError).toBe(true)
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })
})
