import { describe, expect, it, vi } from 'vitest'
import type {
  MaterializedReplaySession,
  SessionRef,
} from '../../src/lib/api/contracts'
import { createSessionSource, type ProviderDescriptor } from '../../server/providers/index'
import type { SessionCatalogProvider } from '../../server/catalog'
import type { NormalizedSession } from '../../src/lib/session'

describe('createSessionSource', () => {
  it('merges provider sessions, skips missing modules, routes load by cached ref', async () => {
    const claudeSession: SessionRef = {
      id: 'claude-1',
      path: '/tmp/claude-1.jsonl',
      source: 'claude-code',
      title: 'Claude Session',
      updatedAt: '2026-04-13T10:00:00.000Z',
    }
    const codexSession: SessionRef = {
      id: 'codex-1',
      path: '/tmp/codex-1.jsonl',
      source: 'codex',
      title: 'Codex Session',
      updatedAt: '2026-04-14T10:00:00.000Z',
    }
    const codexLoadedSession: MaterializedReplaySession = {
      id: codexSession.id,
      title: codexSession.title,
      source: codexSession.source,
      turns: [],
    }
    const createProvider = (
      session: SessionRef,
      searchText: string,
      normalizedSession: NormalizedSession,
    ): SessionCatalogProvider => ({
      source: session.source,
      scan: vi.fn(async () => [
        {
          source: session.source,
          path: session.path,
          relativePath: `${session.source}/${session.id}.jsonl`,
          fingerprint: { path: session.path, mtimeMs: 1, size: 1 },
        },
      ]),
      index: vi.fn(async (file) => ({
        file,
        ref: {
          id: session.id,
          path: session.path,
          source: session.source,
          project: session.project ?? 'session',
          title: session.title,
          startedAt: session.startedAt ?? null,
          updatedAt: session.updatedAt ?? null,
          cwd: session.cwd ?? null,
          summary: session.summary,
          stats: session.stats,
        },
        searchDoc: {
          metadataText: `${session.title} ${session.source}`.toLowerCase(),
          transcriptText: searchText,
        },
        warnings: [],
      })),
      load: vi.fn(async () => normalizedSession),
    })
    const claudeProvider = createProvider(
      claudeSession,
      'claude transcript',
      {
        ref: {
          id: claudeSession.id,
          path: claudeSession.path,
          source: 'claude-code',
          project: 'session',
          title: claudeSession.title,
          startedAt: null,
          updatedAt: claudeSession.updatedAt ?? null,
          cwd: null,
        },
        cwd: null,
        warnings: [],
        turns: [],
      },
    )
    const codexProvider = createProvider(codexSession, 'codex transcript', {
      ref: {
        id: codexSession.id,
        path: codexSession.path,
        source: 'codex',
        project: 'session',
        title: codexSession.title,
        startedAt: null,
        updatedAt: codexSession.updatedAt ?? null,
        cwd: null,
      },
      cwd: null,
      warnings: [],
      turns: [],
    })
    const descriptors: readonly ProviderDescriptor[] = [
      { key: 'claude', modulePath: './claude.ts' },
      { key: 'codex', modulePath: './codex-provider.ts' },
      { key: 'cursor', modulePath: './cursor.ts' },
    ]
    const moduleLoader = vi.fn(async (descriptor: Readonly<ProviderDescriptor>) => {
      if (descriptor.key === 'claude') {
        return {
          createSessionProvider: () => claudeProvider,
        }
      }

      if (descriptor.key === 'codex') {
        return {
          createSessionProvider: () => codexProvider,
        }
      }

      return null
    })

    const sessionSource = await createSessionSource({
      descriptors,
      homeDirectory: '/tmp/home',
      moduleLoader,
    })

    await expect(sessionSource.listSessions()).resolves.toEqual([codexSession, claudeSession])
    await expect(sessionSource.searchSessions({ query: 'codex', limit: 10 })).resolves.toEqual([
      codexSession,
    ])
    await expect(sessionSource.loadSession({ path: codexSession.path })).resolves.toMatchObject(
      codexLoadedSession,
    )

    expect(moduleLoader).toHaveBeenCalledTimes(3)
    expect(codexProvider.load).toHaveBeenCalledTimes(1)
    expect(claudeProvider.load).not.toHaveBeenCalled()
  })
})
