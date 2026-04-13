import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createCursorProvider } from '../../server/providers/cursor'

describe('cursor provider', () => {
  it('scans transcript files, indexes metadata, and loads one session', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'cursor-provider-'))
    const sessionDir = join(
      homeDirectory,
      '.cursor',
      'projects',
      '-Users-test-ble-app',
      'agent-transcripts',
      'cursor-1',
    )
    const transcriptPath = join(sessionDir, 'transcript.jsonl')

    try {
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        transcriptPath,
        [
          JSON.stringify({
            role: 'user',
            message: {
              content: [{ type: 'text', text: '<user_query>\nscan for ble devices\n</user_query>' }],
            },
            timestamp: '2026-04-12T11:00:00.000Z',
          }),
          JSON.stringify({
            role: 'assistant',
            message: { content: [{ type: 'text', text: 'Planning scan.' }] },
            timestamp: '2026-04-12T11:00:01.000Z',
          }),
          JSON.stringify({
            role: 'assistant',
            message: { content: [{ type: 'text', text: 'Found two devices.' }] },
            timestamp: '2026-04-12T11:00:02.000Z',
          }),
        ].join('\n'),
        'utf8',
      )

      const provider = createCursorProvider()
      const files = await provider.scan({ homeDir: homeDirectory })

      expect(files).toHaveLength(1)
      expect(files[0]?.relativePath).toBe('-Users-test-ble-app/agent-transcripts/cursor-1/transcript.jsonl')

      const indexed = await provider.index(files[0]!)
      expect(indexed.ref.project).toBe('ble-app')
      expect(indexed.searchDoc.transcriptText).toContain('scan for ble devices')

      const loaded = await provider.load(files[0]!)
      expect(loaded.ref.id).toBe(indexed.ref.id)
      expect(loaded.turns).toHaveLength(1)
      expect(loaded.turns[0]?.userText).toBe('scan for ble devices')
      expect(loaded.turns[0]?.assistantBlocks).toHaveLength(2)
      expect(loaded.turns[0]?.assistantBlocks[0]?.kind).toBe('thinking')
      expect(loaded.turns[0]?.assistantBlocks[1]?.kind).toBe('text')
    } finally {
      await rm(homeDirectory, { force: true, recursive: true })
    }
  })
})
