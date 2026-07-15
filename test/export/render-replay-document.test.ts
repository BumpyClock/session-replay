import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import type { MaterializedReplaySession } from '../../src/lib/api/contracts'
import { renderReplayDocument } from '../../server/export/render-replay-document'
import {
  createParityMaterializedSession,
  PLAYBACK_PARITY_TRACE,
} from '../fixtures/playback-parity'

function createFixtureSession(): MaterializedReplaySession {
  return {
    bookmarks: [
      {
        id: 'bookmark:turn-2',
        label: 'Thinking step',
        turnIndex: 1,
      },
      {
        id: 'bookmark:turn-3',
        label: 'Answer',
        turnIndex: 2,
      },
    ],
    id: 'session-export',
    source: 'codex',
    startedAt: '2026-04-13T08:00:00.000Z',
    title: 'Export replay',
    turns: [
      {
        blocks: [
          {
            id: 'turn-1-user',
            text: [
              'Inspect export flow',
              '',
              '<skill-context name="ux-designer">',
              'Base directory for this skill: /skills/ux-designer',
              '',
              'Related files (use view tool to read):',
              '  - /skills/ux-designer/design-direction.md',
              '  - /skills/ux-designer/interaction-visual-clarity.md',
              '',
              '---',
              'name: ux-designer',
              'description: Create UX design documentation, layout specs, interaction flows, and style guides.',
              'context: fork',
              '---',
              '',
              '# Core Workflow',
              '',
              '## Design Direction',
              '</skill-context>',
            ].join('\n'),
            type: 'text',
          },
        ],
        id: 'turn-1',
        index: 0,
        role: 'user',
        timestamp: '2026-04-13T08:00:01.000Z',
      },
      {
        blocks: [
          {
            id: 'turn-2-thinking',
            text: 'Sensitive chain of thought',
            type: 'thinking',
          },
        ],
        id: 'turn-2',
        index: 1,
        role: 'assistant',
        timestamp: '2026-04-13T08:00:02.000Z',
      },
      {
        blocks: [
          {
            id: 'turn-3-answer',
            text: 'Fixed export mapping.',
            type: 'markdown',
          },
          {
            id: 'turn-3-tool',
            type: 'tool',
            name: 'Read',
            status: 'completed',
            input: { file_path: 'src/App.tsx' },
            output: 'const html = render()',
          },
        ],
        id: 'turn-3',
        index: 2,
        role: 'assistant',
        timestamp: '2026-04-13T08:00:03.000Z',
      },
    ],
    updatedAt: '2026-04-13T08:05:00.000Z',
  }
}

type ScheduledTimer = {
  delayMs: number
  run: () => void
}

type ExportDomOptions = {
  reducedMotion?: boolean
  scheduledTimers?: ScheduledTimer[]
}

async function createExportDom(html: string, options: ExportDomOptions = {}): Promise<JSDOM> {
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      const nativeSetTimeout = window.setTimeout.bind(window)
      const nativeClearTimeout = window.clearTimeout.bind(window)
      const scheduledTimerIds = new Set<number>()
      let nextTimerId = 10_000

      window.matchMedia = ((query: string) => ({
        addEventListener() {},
        addListener() {},
        dispatchEvent: () => false,
        matches: Boolean(options.reducedMotion && query === '(prefers-reduced-motion: reduce)'),
        media: query,
        onchange: null,
        removeEventListener() {},
        removeListener() {},
      })) as typeof window.matchMedia

      if (options.scheduledTimers) {
        window.setTimeout = ((handler: TimerHandler, timeout = 0, ...args: unknown[]) => {
          if (timeout === 0) {
            return nativeSetTimeout(handler, timeout, ...args)
          }

          const id = nextTimerId
          nextTimerId += 1
          scheduledTimerIds.add(id)
          options.scheduledTimers!.push({
            delayMs: timeout,
            run: () => {
              if (!scheduledTimerIds.delete(id)) return
              if (typeof handler === 'function') {
                handler(...args)
              } else {
                window.eval(handler)
              }
            },
          })
          return id
        }) as typeof window.setTimeout
        window.clearTimeout = ((id?: number) => {
          if (id !== undefined && scheduledTimerIds.delete(id)) return
          nativeClearTimeout(id)
        }) as typeof window.clearTimeout
      }

      window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        callback(0)
        return 1
      }) as typeof window.requestAnimationFrame
      window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame
      Object.defineProperty(window.HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value(this: HTMLElement, arg1: ScrollToOptions | number, arg2?: number) {
          const top = typeof arg1 === 'object'
            ? (arg1.top ?? 0)
            : (arg2 ?? 0)
          Object.defineProperty(this, 'scrollTop', {
            configurable: true,
            value: top,
            writable: true,
          })
          this.dispatchEvent(new window.Event('scroll'))
        },
      })
    },
  })

  await new Promise((resolve) => {
    dom.window.setTimeout(resolve, 0)
  })

  return dom
}

describe('renderReplayDocument', () => {
  const getVisibleUnitIds = (document: Document) => Array.from(document.querySelectorAll('.replay-playback-unit'))
    .filter((node) => !(node as HTMLElement).hidden)
    .map((node) => (node as HTMLElement).dataset.replayUnitId)
    .filter((id): id is string => Boolean(id))

  it('pauses at completion and resets play or next to the first frame', async () => {
    const scheduledTimers: ScheduledTimer[] = []
    const dom = await createExportDom(renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
    }), { scheduledTimers })
    const { document } = dom.window
    const play = document.querySelector('[data-action="toggle-play"]') as HTMLButtonElement
    const next = document.querySelector('[data-action="next"]') as HTMLButtonElement
    const turns = Array.from(document.querySelectorAll('.replay-turn')) as HTMLElement[]
    const payload = JSON.parse(document.getElementById('replay-payload')!.textContent!) as {
      playbackTimeline: { frames: unknown[] }
    }

    play.click()
    for (let index = 0; index < 20 && play.getAttribute('aria-label') === 'Pause playback'; index += 1) {
      const timer = scheduledTimers.shift()
      expect(timer).toBeDefined()
      timer!.run()
    }

    expect(play.getAttribute('aria-label')).toBe('Play transcript')
    expect(turns.map((turn) => turn.hidden)).toEqual([false, false, false])

    play.click()
    expect(play.getAttribute('aria-label')).toBe('Pause playback')
    expect(turns.map((turn) => turn.hidden)).toEqual([false, true, true])

    play.click()
    for (let index = 1; index < payload.playbackTimeline.frames.length; index += 1) next.click()
    expect(turns.every((turn) => !turn.hidden)).toBe(true)
    next.click()
    expect(play.getAttribute('aria-label')).toBe('Play transcript')
    expect(turns.map((turn) => turn.hidden)).toEqual([false, true, true])

    dom.window.close()
  })

  it('reschedules the active frame at the cycled speed without moving the cursor', async () => {
    const session = createFixtureSession()
    session.turns[1]!.blocks = [{
      id: 'turn-2-thinking',
      text: 'x'.repeat(900),
      type: 'thinking',
    }]
    const scheduledTimers: ScheduledTimer[] = []
    const dom = await createExportDom(renderReplayDocument(session, {
      includeThinking: true,
    }), { scheduledTimers })
    const { document } = dom.window
    const next = document.querySelector('[data-action="next"]') as HTMLButtonElement
    const play = document.querySelector('[data-action="toggle-play"]') as HTMLButtonElement
    const speed = document.querySelector('[data-action="speed"]') as HTMLButtonElement

    next.click()
    const visibleBefore = getVisibleUnitIds(document)
    play.click()
    expect(scheduledTimers.at(-1)?.delayMs).toBe(225)

    speed.click()
    expect(speed.textContent).toBe('8x')
    expect(scheduledTimers.at(-1)?.delayMs).toBe(113)
    expect(getVisibleUnitIds(document)).toEqual(visibleBefore)

    play.click()
    dom.window.close()
  })

  it.each(['wheel', 'pointerdown', 'touchstart'])('detaches only after %s user intent', async (intentType) => {
    const dom = await createExportDom(renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
    }))
    const { document } = dom.window
    const content = document.querySelector('[data-playback-content]') as HTMLElement
    const stage = document.querySelector('[data-playback-stage]') as HTMLElement
    Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 960 })
    Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 320 })

    content.dispatchEvent(new dom.window.Event('scroll'))
    expect(stage.dataset.viewportState).not.toBe('user-detached')

    content.dispatchEvent(new dom.window.Event(intentType))
    content.dispatchEvent(new dom.window.Event('scroll'))
    expect(stage.dataset.viewportState).toBe('user-detached')

    dom.window.close()
  })

  it('keeps programmatic auto-follow attached', async () => {
    const dom = await createExportDom(renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
    }))
    const { document } = dom.window
    const content = document.querySelector('[data-playback-content]') as HTMLElement
    const stage = document.querySelector('[data-playback-stage]') as HTMLElement
    const next = document.querySelector('[data-action="next"]') as HTMLButtonElement
    Object.defineProperty(content, 'scrollHeight', { configurable: true, get: () => 960 })
    Object.defineProperty(content, 'clientHeight', { configurable: true, get: () => 320 })

    next.click()

    expect(stage.dataset.viewportState).toBe('overflow-scrollable')
    expect(stage.dataset.viewportState).not.toBe('user-detached')
    expect(content.scrollTop).toBeGreaterThanOrEqual(0)

    dom.window.close()
  })

  it('keeps transition order independent of reduced-motion preference', async () => {
    const transitionOrder = async (reducedMotion: boolean) => {
      const dom = await createExportDom(renderReplayDocument(createFixtureSession(), {
        includeThinking: true,
      }), { reducedMotion })
      const { document } = dom.window
      const next = document.querySelector('[data-action="next"]') as HTMLButtonElement
      const order = [getVisibleUnitIds(document)]

      for (let index = 0; index < 5; index += 1) {
        next.click()
        order.push(getVisibleUnitIds(document))
      }
      dom.window.close()
      return order
    }

    const html = renderReplayDocument(createFixtureSession())
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    expect(html).not.toContain('matchMedia(')
    await expect(transitionOrder(true)).resolves.toEqual(await transitionOrder(false))
  })

  it('matches the shared playback trace from its paused policy', async () => {
    const dom = await createExportDom(renderReplayDocument(createParityMaterializedSession()))
    const { document } = dom.window
    const next = document.querySelector('[data-action="next"]') as HTMLButtonElement
    const previous = document.querySelector('[data-action="prev"]') as HTMLButtonElement
    const play = document.querySelector('[data-action="toggle-play"]') as HTMLButtonElement
    const observe = () => ({
      activeUnitId: (document.querySelector('.replay-playback-unit.is-active') as HTMLElement | null)?.dataset.replayUnitId ?? null,
      mode: play.getAttribute('aria-label') === 'Pause playback' ? 'playing' : 'paused',
      nextDisabled: next.disabled,
      previousDisabled: previous.disabled,
      viewportState: (document.querySelector('[data-viewport-state]') as HTMLElement).dataset.viewportState,
      visibleTurnIds: Array.from(document.querySelectorAll('.replay-turn'))
        .filter((node) => !(node as HTMLElement).hidden)
        .map((node) => (node as HTMLElement).dataset.turnId),
      visibleUnitIds: Array.from(document.querySelectorAll('[data-turn-id="parity-assistant"] .replay-playback-unit'))
        .filter((node) => !(node as HTMLElement).hidden)
        .map((node) => (node as HTMLElement).dataset.replayUnitId)
        .filter((id): id is string => Boolean(id)),
    })
    const trace = [observe()]

    for (const action of [next, next, next, previous, next, next, next]) {
      action.click()
      trace.push(observe())
    }

    expect(trace).toEqual(PLAYBACK_PARITY_TRACE)

    dom.window.close()
  })

  it('stores transcript content once and keeps payload playback-only', () => {
    const sentinel = 'UNIQUE_EXPORT_TRANSCRIPT_SENTINEL'
    const session = createFixtureSession()
    session.turns[0]!.blocks = [{
      id: 'sentinel-block',
      type: 'text',
      text: `${'prefix '.repeat(80)}${sentinel}`,
    }]

    const html = renderReplayDocument(session)
    const payloadText = html.match(/<script type="application\/json" id="replay-payload">([^<]*)<\/script>/)?.[1]

    expect(html.match(new RegExp(sentinel, 'g'))).toHaveLength(1)
    expect(payloadText).toBeDefined()
    expect(JSON.parse(payloadText!)).toEqual(expect.objectContaining({
      playbackTurns: expect.any(Array),
      playbackTimeline: expect.any(Object),
      initialFrameIndex: 0,
    }))
    expect(payloadText).not.toContain(sentinel)
  })

  it('embeds shared frames and viewport policy without a second transition algorithm', () => {
    const html = renderReplayDocument(createFixtureSession())

    expect(html).toContain('"playbackTimeline"')
    expect(html).toContain('"programmaticScrollGuardMs":150')
    expect(html).not.toContain('function getNextPlaybackState')
    expect(html).not.toContain('function getPreviousPlaybackState')
    expect(html).not.toContain('function getNextPlaybackDelay')
    expect(html).not.toContain('eval(')
    expect(html).not.toContain('import(')
    expect(html).not.toContain('<script src=')
  })

  it('adds transcript text to the exported document only once', () => {
    const renderWithTextSize = (size: number) => {
      const session = createFixtureSession()
      session.turns = [{
        id: 'turn-size',
        index: 0,
        role: 'assistant',
        blocks: [{ id: 'block-size', type: 'text', text: `UNIQUE_${'x'.repeat(size)}` }],
      }]
      return renderReplayDocument(session)
    }

    const small = renderWithTextSize(16_384)
    const large = renderWithTextSize(32_768)

    // Before payload deduplication, the 16 KiB input delta added exactly 32,768 chars.
    expect(large.length - small.length).toBeLessThanOrEqual(20_480)
  })

  it('uses the same preview shell as the in-editor playback view', () => {
    const html = renderReplayDocument(createFixtureSession(), {
      includeThinking: false,
      initialTurnIndex: 2,
    })

    expect(html).toContain('data-playback-transcript')
    expect(html).not.toContain('data-virtual-transcript')
    expect(html).toContain('data-turn-index="0"')
    expect(html).toContain('data-turn-index="1"')
    expect(html).not.toContain('data-turn-index="2"')
    expect(html).not.toContain('Thinking step')
    expect(html).toContain('class="preview-block preview-block--export"')
    expect(html).toContain('class="preview-block__dock" role="toolbar" aria-label="Playback controls"')
    expect(html).not.toContain('preview-block__transcript--virtual')
    expect(html).toContain('[hidden] {\n  display: none !important;\n}')
    expect(html).toContain('.export-page__preview {\n  width: min(100%, 1040px);\n  height: calc(100svh - 32px);')
    expect(html).toContain('replay-turn replay-turn--tool')
    expect(html).toContain('replay-turn__note-pill')
    expect(html).toContain('Answer')
    expect(html).not.toContain('class="hero"')
    expect(html).not.toContain('class="content-grid"')
    expect(html).not.toContain('data-action="expand-all"')
    expect(html).not.toContain('data-action="collapse-all"')
  })

  it('applies revealThinking and keepTimestamps to rendered output', () => {
    const hiddenThinkingHtml = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      keepTimestamps: false,
      revealThinking: false,
    })

    expect(hiddenThinkingHtml).toContain('Sensitive chain of thought')
    expect(hiddenThinkingHtml).not.toContain('2026-04-13T08:00:01.000Z')
    expect(hiddenThinkingHtml).not.toContain('<time class="replay-turn__timestamp"')
    expect(hiddenThinkingHtml).toContain('Tool: Read')
    expect(hiddenThinkingHtml).toContain('completed · src/App.tsx')
    expect(hiddenThinkingHtml).toContain('replay-turn replay-turn--tool')
    expect(hiddenThinkingHtml).toContain('replay-turn__note-pill')
    expect(hiddenThinkingHtml).toContain('Answer')
    expect(hiddenThinkingHtml).toContain('replay-disclosure replay-disclosure--thinking')
    expect(hiddenThinkingHtml).toContain('data-replay-kind="thinking"')

    const revealedThinkingHtml = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      keepTimestamps: true,
      revealThinking: true,
    })

    expect(revealedThinkingHtml).toContain('Sensitive chain of thought')
    expect(revealedThinkingHtml).toContain('class="replay-turn__timestamp"')
    expect(revealedThinkingHtml).not.toContain('<time ')
    expect(revealedThinkingHtml).toContain('replay-disclosure replay-disclosure--thinking" data-replay-kind="thinking" open=""')
    expect(revealedThinkingHtml).toContain('replay-disclosure replay-disclosure--tool')
    expect(revealedThinkingHtml).toContain('Skill context')
    expect(revealedThinkingHtml).toContain('ux-designer')
    expect(revealedThinkingHtml).not.toContain('&lt;skill-context')
    expect(revealedThinkingHtml).toContain('replay-turn__bookmark')
  })

  it('filters tool blocks when export disables tool call rendering', () => {
    const html = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
      includeToolCalls: false,
    })

    expect(html).not.toContain('Tool: Read')
    expect(html).not.toContain('const html = render()')
  })

  it('renders markdown blocks and escapes raw html in export output', () => {
    const session = createFixtureSession()
    session.turns[2] = {
      ...session.turns[2],
      blocks: [
        {
          id: 'turn-3-answer',
          text: '## Heading\n\n- item one\n\n<div class="evil">owned</div>',
          type: 'markdown',
        },
      ],
    }

    const html = renderReplayDocument(session, {
      includeThinking: true,
    })

    expect(html).toContain('<h2>Heading</h2>')
    expect(html).toContain('<li>item one</li>')
    expect(html).not.toContain('<div class="evil">owned</div>')
    expect(html).toContain('&lt;div class=&quot;evil&quot;&gt;owned&lt;/div&gt;')
  })

  it('groups long consecutive tool runs behind a shared disclosure', () => {
    const session = createFixtureSession()
    session.turns[2] = {
      ...session.turns[2],
      blocks: Array.from({ length: 5 }, (_, index) => ({
        id: `turn-3-tool-${index}`,
        type: 'tool' as const,
        name: index % 2 === 0 ? 'Read' : 'Bash',
        status: index === 4 ? 'failed' : 'completed',
        input: index % 2 === 0 ? { file_path: `src/file-${index}.ts` } : { command: `echo ${index}` },
        output: `result-${index}`,
        isError: index === 4,
      })),
    }

    const html = renderReplayDocument(session, {
      includeThinking: false,
      includeToolCalls: true,
    })

    expect(html).toContain('replay-tool-group')
    expect(html).toContain('5 tool calls')
    expect(html).toContain('Read, Bash')
    expect(html).toContain('1 failed')
  })

  it('groups short consecutive tool runs behind a shared disclosure', () => {
    const session = createFixtureSession()
    session.turns[2] = {
      ...session.turns[2],
      blocks: [
        {
          id: 'turn-3-tool-1',
          type: 'tool',
          name: 'Read',
          status: 'completed',
          input: { file_path: 'src/App.tsx' },
          output: 'result-1',
        },
        {
          id: 'turn-3-tool-2',
          type: 'tool',
          name: 'Bash',
          status: 'completed',
          input: { command: 'echo ok' },
          output: 'result-2',
        },
      ],
    }

    const html = renderReplayDocument(session, {
      includeThinking: false,
      includeToolCalls: true,
    })

    expect(html).toContain('replay-tool-group')
    expect(html).toContain('2 tool calls')
    expect(html).toContain('Read, Bash')
    expect(html).not.toContain('data-action="toggle-thinking"')
  })

  it('starts the standalone playback transcript from the current step instead of showing future turns', async () => {
    const html = renderReplayDocument(createFixtureSession(), {
      includeThinking: true,
    })
    const dom = await createExportDom(html)
    const { document } = dom.window

    const stage = document.querySelector('[data-playback-stage]') as HTMLDivElement | null
    const transcript = document.querySelector('[data-playback-transcript]')
    const playButton = document.querySelector('[data-action="toggle-play"]') as HTMLButtonElement | null
    const turnNodes = Array.from(document.querySelectorAll('.replay-turn')) as HTMLLIElement[]

    expect(stage?.getAttribute('data-viewport-state')).toBe('underflow-bottom-anchored')
    expect(transcript).not.toBeNull()
    expect(transcript?.classList.contains('preview-block__transcript--virtual')).toBe(false)
    expect(playButton?.getAttribute('aria-label')).toBe('Play transcript')
    expect(turnNodes).toHaveLength(3)
    expect(turnNodes[0]?.hidden).toBe(false)
    expect(turnNodes[1]?.hidden).toBe(true)
    expect(turnNodes[2]?.hidden).toBe(true)
    expect(turnNodes.every((node) => !node.getAttribute('style')?.includes('position:absolute'))).toBe(true)

    playButton?.click()

    expect(playButton?.getAttribute('aria-label')).toBe('Pause playback')
    expect(stage?.getAttribute('data-viewport-state')).toBe('underflow-bottom-anchored')
    expect(turnNodes[0]?.hidden).toBe(false)
    expect(turnNodes[1]?.hidden).toBe(true)
  })
})
