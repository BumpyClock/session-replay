import { describe, expect, it, vi } from 'vitest'
import type {
  MaterializedReplaySession,
  SessionLoadRequest,
  SessionRef,
  SessionSearchRequest,
} from '../../src/lib/api/contracts'
import { createSessionSource, type ProviderDescriptor } from '../../server/providers/index'

describe('createSessionSource', () => {
  it('merges provider sessions, skips missing modules, routes load by cached ref', async () => {
    const claudeSession: SessionRef = {
      id: 'claude-1',
      path: '/tmp/claude-1.jsonl',
      source: 'claude',
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
    const claudeListSessions = vi.fn<() => Promise<readonly SessionRef[]>>().mockResolvedValue([
      claudeSession,
    ])
    const claudeSearchSessions = vi
      .fn<(request: Readonly<SessionSearchRequest>) => Promise<readonly SessionRef[]>>()
      .mockImplementation(async (request) => (request.query.includes('claude') ? [claudeSession] : []))
    const claudeLoadSession = vi
      .fn<(request: Readonly<SessionLoadRequest>) => Promise<MaterializedReplaySession>>()
      .mockImplementation(async () => {
        throw new Error('claude load should not be called for codex request')
      })
    const codexListSessions = vi.fn<() => Promise<readonly SessionRef[]>>().mockResolvedValue([
      codexSession,
    ])
    const codexSearchSessions = vi
      .fn<(request: Readonly<SessionSearchRequest>) => Promise<readonly SessionRef[]>>()
      .mockImplementation(async (request) => (request.query.includes('codex') ? [codexSession] : []))
    const codexLoadSession = vi
      .fn<(request: Readonly<SessionLoadRequest>) => Promise<MaterializedReplaySession>>()
      .mockResolvedValue(codexLoadedSession)
    const descriptors: readonly ProviderDescriptor[] = [
      { key: 'claude', modulePath: './claude.ts' },
      { key: 'codex', modulePath: './codex-provider.ts' },
      { key: 'cursor', modulePath: './cursor.ts' },
    ]
    const moduleLoader = vi.fn(async (descriptor: Readonly<ProviderDescriptor>) => {
      if (descriptor.key === 'claude') {
        return {
          createSessionSource: () => ({
            listSessions: claudeListSessions,
            loadSession: claudeLoadSession,
            searchSessions: claudeSearchSessions,
          }),
        }
      }

      if (descriptor.key === 'codex') {
        return {
          createSessionSource: () => ({
            listSessions: codexListSessions,
            loadSession: codexLoadSession,
            searchSessions: codexSearchSessions,
          }),
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
    await expect(sessionSource.loadSession({ path: codexSession.path })).resolves.toEqual(
      codexLoadedSession,
    )

    expect(moduleLoader).toHaveBeenCalledTimes(3)
    expect(codexLoadSession).toHaveBeenCalledWith({ path: codexSession.path })
    expect(claudeLoadSession).not.toHaveBeenCalled()
  })
})
