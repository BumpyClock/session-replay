import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionProvider } from '../../server/providers/codex-provider'

describe('codex control block ingest', () => {
  let homeDirectory: string
  let sessionPath: string

  beforeEach(async () => {
    homeDirectory = await mkdtemp(join(tmpdir(), 'codex-control-blocks-'))
    const dayPath = join(homeDirectory, '.codex', 'sessions', '2026', '04', '14')
    await mkdir(dayPath, { recursive: true })

    sessionPath = join(dayPath, 'rollout-2026-04-14T12-00-00-project-alpha.jsonl')
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-04-14T12:00:00.000Z',
          payload: { cwd: '/Users/dev/projects/alpha', cli_version: '0.115.0' },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-04-14T12:00:01.000Z',
          payload: {
            type: 'turn_context',
            approval_policy: 'never',
            sandbox_policy: { type: 'danger-full-access' },
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-04-14T12:00:02.000Z',
          payload: { type: 'task_started' },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-14T12:00:03.000Z',
          payload: {
            type: 'message',
            role: 'developer',
            content: [
              {
                type: 'output_text',
                text: [
                  '<permissions instructions>',
                  'Filesystem sandboxing defines which files can be read or written. sandbox_mode is danger-full-access: No filesystem sandboxing - all commands are permitted. Network access is enabled.',
                  'Approval policy is currently never. Do not provide the sandbox_permissions for any reason, commands will be rejected.',
                  '</permissions instructions>',
                ].join('\n'),
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-04-14T12:00:04.000Z',
          payload: {
            type: 'user_message',
            message: '## My request for Codex:\nInspect auth flow',
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-14T12:00:05.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'On it.' }],
          },
        }),
      ].join('\n'),
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(homeDirectory, { force: true, recursive: true })
  })

  it('keeps structured runtime records and developer wrappers as system blocks', async () => {
    const provider = createSessionProvider()
    const files = await provider.scan({ homeDir: homeDirectory })
    const loaded = await provider.load(files[0]!)

    expect(loaded.turns[0]?.systemBlocks[0]?.text).toContain('<session_meta>')
    expect(loaded.turns[1]?.systemBlocks[0]?.text).toContain('<turn_context>')
    expect(loaded.turns[2]?.systemBlocks[0]?.text).toContain('<permissions instructions>')
    expect(loaded.turns[2]?.userText).toBe('Inspect auth flow')
    expect(loaded.turns[2]?.assistantBlocks[0]).toMatchObject({
      kind: 'text',
      text: 'On it.',
    })
  })
})
