import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionProvider } from '../../server/providers/claude-code'

describe('claude-code control block ingest', () => {
  let homeDir: string
  let sessionPath: string

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'claude-code-control-blocks-'))
    const projectDir = join(homeDir, '.claude', 'projects', '-Users-test-Workspace')
    await mkdir(projectDir, { recursive: true })

    sessionPath = join(projectDir, 'control-session.jsonl')
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'attachment',
          timestamp: '2026-04-14T12:00:00.000Z',
          attachment: {
            type: 'plan_mode',
            planFilePath: '/Users/test/.claude/plans/auth-plan.md',
          },
        }),
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-14T12:00:01.000Z',
          message: { role: 'user', content: 'Check auth flow' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-04-14T12:00:02.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '<teammate-message teammate_id="fix-auth" color="green" summary="Fix complete">Patched auth middleware.</teammate-message>' }],
          },
        }),
      ].join('\n'),
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(homeDir, { force: true, recursive: true })
  })

  it('captures top-level Claude runtime records as system blocks', async () => {
    const provider = createSessionProvider()
    const files = await provider.scan({ homeDir })
    const loaded = await provider.load(files[0]!)

    expect(loaded.turns[0]?.systemBlocks[0]?.text).toContain('<claude_attachment>')
    expect(loaded.turns[1]?.userText).toBe('Check auth flow')
    expect(loaded.turns[1]?.assistantBlocks[0]).toMatchObject({
      kind: 'text',
      text: '<teammate-message teammate_id="fix-auth" color="green" summary="Fix complete">Patched auth middleware.</teammate-message>',
    })
  })
})
