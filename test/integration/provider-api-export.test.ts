import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiHandler } from '../../server/api/handler'
import { createSessionCatalogService } from '../../server/catalog'
import type {
  SessionListResponse,
  SessionLoadResponse,
} from '../../src/lib/api/contracts'

describe('provider to API export integration', () => {
  let homeDirectory: string
  let sessionPath: string

  beforeEach(async () => {
    homeDirectory = await mkdtemp(join(tmpdir(), 'session-replay-integration-'))
    const sessionDirectory = join(homeDirectory, '.codex', 'sessions', '2026', '07', '14')
    await mkdir(sessionDirectory, { recursive: true })
    sessionPath = join(sessionDirectory, 'rollout-2026-07-14T12-00-00-integration.jsonl')
    const records = [
      {
        type: 'session_meta',
        timestamp: '2026-07-14T12:00:00.000Z',
        payload: { cwd: join(homeDirectory, 'projects', 'integration') },
      },
      {
        type: 'event_msg',
        timestamp: '2026-07-14T12:00:01.000Z',
        payload: { type: 'task_started' },
      },
      {
        type: 'event_msg',
        timestamp: '2026-07-14T12:00:02.000Z',
        payload: { type: 'user_message', message: 'provider-api-export-sentinel' },
      },
      {
        type: 'response_item',
        timestamp: '2026-07-14T12:00:03.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'assistant-export-sentinel' }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-07-14T12:00:04.000Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call-integration',
          arguments: JSON.stringify({ cmd: 'echo integration' }),
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-07-14T12:00:05.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-integration',
          output: 'tool-output-sentinel',
        },
      },
      { type: 'event_msg', payload: { type: 'task_complete' } },
    ]
    await writeFile(sessionPath, records.map((record) => JSON.stringify(record)).join('\n'))
  })

  afterEach(async () => {
    await rm(homeDirectory, { force: true, recursive: true })
  })

  it('lists, loads, and exports a real Codex transcript', async () => {
    const sessionSource = createSessionCatalogService({ homeDirectory })
    const handler = createApiHandler({ homeDirectory, sessionSource })
    const listBody = await waitForReadyCatalog(handler)

    expect(listBody.sessions).toEqual([
      expect.objectContaining({ path: sessionPath, source: 'codex' }),
    ])
    expect(listBody.catalog).toEqual(expect.objectContaining({
      discoveredCount: 1,
      indexedCount: 1,
      pendingCount: 0,
      state: 'ready',
    }))
    expect(listBody.warnings).toBeUndefined()

    const loadResponse = await handler(jsonRequest('/api/load', { path: listBody.sessions[0]!.path }))
    expect(loadResponse.status).toBe(200)
    const loadBody = await loadResponse.json() as SessionLoadResponse
    const blocks = loadBody.session.turns.flatMap((turn) => turn.blocks)

    expect(listBody.sessions[0]!.path).toBe(sessionPath)
    expect(loadBody.session).toEqual(expect.objectContaining({
      cwd: join(homeDirectory, 'projects', 'integration'),
      source: 'codex',
      startedAt: '2026-07-14T12:00:00.000Z',
      title: 'provider-api-export-sentinel',
    }))
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'provider-api-export-sentinel' }),
      expect.objectContaining({ text: 'assistant-export-sentinel' }),
      expect.objectContaining({
        name: 'Bash',
        input: { command: 'echo integration' },
        output: 'tool-output-sentinel',
      }),
    ]))

    const exportResponse = await handler(jsonRequest('/api/export?fileName=integration-replay', {
      session: loadBody.session,
      options: {
        exportTitle: 'Integration replay',
        includeThinking: true,
        includeToolCalls: true,
        keepTimestamps: true,
        revealThinking: false,
      },
    }))
    expect(exportResponse.status).toBe(200)
    expect(exportResponse.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(exportResponse.headers.get('Content-Disposition')).toBe(
      'attachment; filename="integration-replay.html"',
    )

    const html = await exportResponse.text()
    expect(html).toContain('<title>Integration replay</title>')
    expect(html).toContain('provider-api-export-sentinel')
    expect(html).toContain('assistant-export-sentinel')
    expect(html).toContain('Bash')
    expect(html).toContain('tool-output-sentinel')
    expect(html).toContain('id="replay-payload"')
    expect(html).toContain('aria-label="Playback controls"')
    expectStandaloneDocument(html)

    const payloadText = html.match(/<script type="application\/json" id="replay-payload">([^<]*)<\/script>/)?.[1]
    const payload = JSON.parse(payloadText!) as { playbackTurns: Array<{ turnId: string }> }
    expect(payload.playbackTurns.map((turn) => turn.turnId)).toEqual(
      loadBody.session.turns.map((turn) => turn.id),
    )
  })
})

function expectStandaloneDocument(html: string): void {
  const fetchCapableAttributes = [
    'action',
    'data',
    'formaction',
    'href',
    'poster',
    'src',
    'srcset',
  ]

  for (const attribute of fetchCapableAttributes) {
    const pattern = new RegExp(`\\s${attribute}\\s*=\\s*["'][^"']*https?:\\/\\/`, 'i')
    expect(html).not.toMatch(pattern)
  }

  expect(html).not.toMatch(/@import\s+(?:url\(\s*)?["']?https?:\/\//i)
  expect(html).not.toMatch(/url\(\s*["']?https?:\/\//i)
  expect(html).not.toMatch(/\bfetch\s*\(/)
  expect(html).not.toMatch(/\bXMLHttpRequest\b/)
  expect(html).not.toMatch(/\bWebSocket\b/)
  expect(html).not.toMatch(/\bEventSource\b/)
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://127.0.0.1:4848${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function waitForReadyCatalog(
  handler: (request: Request) => Promise<Response>,
): Promise<SessionListResponse> {
  let lastBody: SessionListResponse | undefined

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await handler(new Request('http://127.0.0.1:4848/api/sessions'))
    expect(response.status).toBe(200)
    lastBody = await response.json() as SessionListResponse
    if (lastBody.catalog?.state === 'ready' && lastBody.catalog.pendingCount === 0) {
      return lastBody
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }

  throw new Error(`Catalog did not become ready: ${JSON.stringify(lastBody)}`)
}
