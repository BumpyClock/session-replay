import { Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserPanel, type SessionSummary } from './features/browser/BrowserPanel'
import { ReplayPanel } from './features/preview/ReplayPanel'
import type { PreviewTurn, ReplaySession } from './features/preview/ReplayPanel'
import { ExportPanel, type ExportOptions } from './features/export/ExportPanel'
import { createSessionReplayApiClient as createApiClient } from './lib/api'
import {
  getSessionBaseRevision,
  materializeReplayRenderRequest,
  materializeReplaySession,
  useEditorStore,
} from './lib/editor'
import type {
  MaterializedReplaySession,
  ReplayRole,
  SessionCatalogStatus,
  SessionRef,
} from './lib/api/contracts'
import type { SessionWarning } from './lib/session'
import { getReplayTurnPreviewText, summarizeReplayTurn } from './lib/replay/blocks'
import { expandReplayBlocks } from './lib/replay/context-blocks'
import { formatReplayToolEditorText } from './lib/replay/tool-format'
import { Sidebar, SidebarInset, SidebarProvider } from './components/ui/sidebar'

const providerLabelMap: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  gemini: 'Gemini',
}

const defaultFileNameFor = (session: Pick<SessionRef, 'id' | 'title'>): string => {
  const base = session.title?.trim() || session.id || 'agent-session-replay'
  const sanitized = base.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return sanitized.replace(/(^-+)|(-+$)/g, '') || 'agent-session-replay'
}

const roleForPreview = (role: ReplayRole): PreviewTurn['role'] => {
  if (role === 'user') {
    return 'user'
  }

  if (role === 'tool') {
    return 'tool'
  }

  return 'assistant'
}

function formatTimeLabel(timestamp?: string | null): string {
  if (!timestamp) {
    return ''
  }

  const time = new Date(timestamp)
  if (Number.isNaN(time.valueOf())) {
    return timestamp
  }

  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatBlockEditorText(
  block: MaterializedReplaySession['turns'][number]['blocks'][number],
): string {
  if (block.type !== 'tool') {
    return block.text
  }

  return formatReplayToolEditorText(block)
}

function makeReplaySession(
  session: MaterializedReplaySession,
  draft: { bookmarks: Record<string, { label: string }> } | undefined,
): ReplaySession {
  const turns: PreviewTurn[] = session.turns.map((turn) => {
    const isHidden = turn.included === false
    const bookmarkLabel = draft?.bookmarks[turn.id]?.label

    return {
      blocks: turn.blocks,
      bookmarkLabel,
      id: turn.id,
      role: roleForPreview(turn.role),
      isBookmarked: Boolean(bookmarkLabel),
      isHidden,
      previewText: getReplayTurnPreviewText(expandReplayBlocks(turn.blocks)),
      summary: summarizeReplayTurn(turn),
      timestamp: turn.timestamp ?? '',
      timeLabel: formatTimeLabel(turn.timestamp),
    }
  })

  return {
    id: session.id,
    provider: providerLabelMap[session.source] ?? session.source,
    project: session.project ?? 'Unknown project',
    cwd: session.cwd ?? '',
    title: session.title,
    updatedAt: session.updatedAt ?? '',
    turnCount: turns.length,
    turns,
  }
}

function makeBrowserRows(sessions: SessionRef[], query: string): SessionSummary[] {
  const trimmed = query.trim().toLowerCase()
  return sessions
    .filter((session) => {
      if (!trimmed) {
        return true
      }

      const haystack = [session.title, session.project, session.path, session.source, session.summary]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(trimmed)
    })
    .map((session) => ({
      id: session.id,
      provider: providerLabelMap[session.source] ?? session.source,
      project: session.project ?? 'Unknown project',
      title: session.title,
      cwd: session.cwd ?? '',
      updatedAt: session.updatedAt ?? '',
      turnCount: session.stats?.turnCount ?? 0,
    }))
}

function resolveApiClient() {
  const explicit = import.meta.env.VITE_SESSION_REPLAY_API_BASE
  const baseUrl = import.meta.env.DEV ? explicit ?? '' : explicit ?? 'http://127.0.0.1:4848'

  return createApiClient(baseUrl)
}

function formatCatalogNotice(warnings: readonly SessionWarning[]): string | null {
  if (warnings.length === 0) {
    return null
  }

  const label = warnings.length === 1 ? 'session was' : 'sessions were'
  return `${warnings.length} ${label} skipped during catalog refresh. Check console for paths.`
}

function formatCatalogSummary(status: SessionCatalogStatus | null, sessionCount: number): string {
  if (!status || status.state === 'ready') {
    return `${sessionCount} sessions loaded`
  }

  const verb = status.state === 'refreshing' ? 'refreshing' : 'indexing'
  return `${sessionCount} sessions loaded · ${verb} ${status.indexedCount}/${status.discoveredCount}`
}

const apiClient = resolveApiClient()
const CATALOG_POLL_INTERVAL_MS = 750

function App() {
  const [browserOpen, setBrowserOpen] = useState(false)
  const [catalogStatus, setCatalogStatus] = useState<SessionCatalogStatus | null>(null)
  const [catalogPollTick, setCatalogPollTick] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [catalogWarnings, setCatalogWarnings] = useState<SessionWarning[]>([])
  const [sessions, setSessions] = useState<SessionRef[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [loadedSession, setLoadedSession] = useState<MaterializedReplaySession | null>(null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const pollingRequestInFlight = useRef(false)

  const ensureDraft = useEditorStore((state) => state.ensureDraft)
  const setBlockText = useEditorStore((state) => state.setBlockText)
  const setBookmark = useEditorStore((state) => state.setBookmark)
  const removeBookmark = useEditorStore((state) => state.removeBookmark)
  const toggleTurnIncluded = useEditorStore((state) => state.toggleTurnIncluded)
  const setExportMeta = useEditorStore((state) => state.setExportMeta)
  const setViewerOptions = useEditorStore((state) => state.setViewerOptions)

  const loadedDraft = useEditorStore((state) => {
    if (!loadedSession) {
      return undefined
    }

    const revision = getSessionBaseRevision({
      id: loadedSession.id,
      updatedAt: loadedSession.updatedAt,
    })
    const draft = state.drafts[loadedSession.id]

    if (!draft || draft.baseRevision !== revision) {
      return undefined
    }

    return draft
  })

  const loadSessions = useCallback(async (options?: { background?: boolean }) => {
    const isBackground = options?.background ?? false
    if (isBackground && pollingRequestInFlight.current) {
      return
    }

    if (isBackground) {
      pollingRequestInFlight.current = true
    } else {
      setSessionsLoading(true)
      setSessionsError(null)
    }

    try {
      const response = await apiClient.listSessions()
      setCatalogStatus(response.catalog ?? null)
      setSessions(response.sessions)
      const nextWarnings = response.warnings ?? []
      setCatalogWarnings(nextWarnings)
      if (nextWarnings.length > 0) {
        console.warn('[catalog] skipped sessions during refresh', nextWarnings)
      }
    } catch (error) {
      if (!isBackground) {
        const message = error instanceof Error ? error.message : 'Failed to load sessions'
        setSessionsError(message)
        setCatalogStatus(null)
        setCatalogWarnings([])
        setSessions([])
      }
    } finally {
      if (isBackground) {
        pollingRequestInFlight.current = false
        setCatalogPollTick((value) => value + 1)
      } else {
        setSessionsLoading(false)
      }
    }
  }, [])

  const visibleSessions = useMemo(() => makeBrowserRows(sessions, searchText), [searchText, sessions])
  const catalogNotice = useMemo(() => formatCatalogNotice(catalogWarnings), [catalogWarnings])
  const catalogSummary = useMemo(
    () => formatCatalogSummary(catalogStatus, sessions.length),
    [catalogStatus, sessions.length],
  )
  const catalogRefreshing = sessionsLoading || (catalogStatus !== null && catalogStatus.state !== 'ready')

  const baseRevision = loadedSession
    ? getSessionBaseRevision({
        id: loadedSession.id,
        updatedAt: loadedSession.updatedAt,
      })
    : ''

  const materializedSession = loadedSession
    ? materializeReplaySession(loadedSession, loadedDraft)
    : null
  const renderRequest = useMemo(() => {
    if (!loadedSession) {
      return null
    }

    return materializeReplayRenderRequest(materializedSession ?? loadedSession, loadedDraft)
  }, [loadedSession, loadedDraft, materializedSession])

  const previewSignature = useMemo(() => {
    if (!loadedSession) {
      return ''
    }

    return JSON.stringify({
      baseRevision,
      blockTextEdits: loadedDraft?.blockTextEdits ?? {},
      excludedTurnIds: loadedDraft?.excludedTurnIds ?? [],
      id: loadedSession.id,
      updatedAt: loadedSession.updatedAt,
      viewerOptions: loadedDraft?.viewerOptions ?? {},
      exportMeta: loadedDraft?.exportMeta ?? {},
    })
  }, [baseRevision, loadedDraft, loadedSession])

  const replaySession = materializedSession ? makeReplaySession(materializedSession, loadedDraft) : null
  const visibleTurnCount = materializedSession
    ? materializedSession.turns.filter((turn) => turn.included !== false).length
    : 0
  const totalTurnCount = materializedSession ? materializedSession.turns.length : 0

  const exportOptions: ExportOptions = useMemo(() => {
    const sessionTitle = loadedSession?.title ?? ''

    return {
      filename:
        loadedDraft?.exportMeta.fileName ??
        defaultFileNameFor({
          id: loadedSession?.id ?? 'session',
          title: sessionTitle,
        }),
      title: loadedDraft?.exportMeta.title ?? sessionTitle,
      includeToolCalls: loadedDraft?.viewerOptions.includeToolCalls ?? true,
      includeThinking: loadedDraft?.viewerOptions.includeThinking ?? false,
      revealThinking: loadedDraft?.viewerOptions.revealThinking ?? false,
      includeTimestamps: loadedDraft?.viewerOptions.includeTimestamps ?? true,
    }
  }, [loadedSession?.id, loadedSession?.title, loadedDraft])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!catalogStatus || catalogStatus.state === 'ready' || sessionsError) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadSessions({ background: true })
    }, CATALOG_POLL_INTERVAL_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [catalogPollTick, catalogStatus, loadSessions, sessionsError])

  useEffect(() => {
    if (!loadedSession) {
      return
    }

    ensureDraft(loadedSession.id, baseRevision)
  }, [baseRevision, ensureDraft, loadedSession])

  useEffect(() => {
    if (!renderRequest || !previewSignature) {
      return
    }

    let isCancelled = false

    const updatePreview = async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const response = await apiClient.previewSession(renderRequest)
        if (!isCancelled) {
          setPreviewHtml(response.html)
        }
      } catch (error) {
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : 'Preview failed'
          setPreviewError(message)
        }
      } finally {
        if (!isCancelled) {
          setPreviewLoading(false)
        }
      }
    }

    void updatePreview()

    return () => {
      isCancelled = true
    }
  }, [previewSignature, renderRequest])

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      const nextRef = sessions.find((session) => session.id === sessionId)
      if (!nextRef) {
        return
      }

      setSessionError(null)
      setSessionLoading(true)
      setSelectedSessionId(sessionId)
      setLoadedSession(null)
      setPreviewHtml('')
      setPreviewError(null)
      try {
        const response = await apiClient.loadSession({ path: nextRef.path })
        setLoadedSession(response.session)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load session'
        setSessionError(message)
      } finally {
        setSessionLoading(false)
        if (window.innerWidth < 901) {
          setBrowserOpen(false)
        }
      }
    },
    [sessions],
  )

  const handleRefresh = useCallback(async () => {
    setSessionError(null)
    await loadSessions()
  }, [loadSessions])

  const handleExportOptionsChange = (next: ExportOptions) => {
    if (!loadedSession || !loadedDraft) {
      return
    }

    const revision = baseRevision
    setExportMeta(loadedSession.id, revision, {
      title: next.title,
      fileName: next.filename,
    })
    setViewerOptions(loadedSession.id, revision, {
      includeThinking: next.includeThinking,
      includeToolCalls: next.includeToolCalls,
      revealThinking: next.revealThinking,
      includeTimestamps: next.includeTimestamps,
    })
  }

  const handleExport = async () => {
    if (!materializedSession || !renderRequest || !loadedSession) {
      return
    }

    setExportError(null)
    setExporting(true)
    try {
      const html = await apiClient.exportSessionDocument(
        renderRequest,
        exportOptions.filename || defaultFileNameFor(loadedSession),
      )
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const fileName = `${exportOptions.filename || 'agent-session-replay'}.html`
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed'
      setExportError(message)
    } finally {
      setExporting(false)
    }
  }

  const handleBlockTextChange = (turnId: string, blockId: string, nextText: string) => {
    if (!loadedSession || !loadedDraft) {
      return
    }

    setBlockText(loadedSession.id, baseRevision, turnId, blockId, nextText)
  }

  const handleBookmarkChange = (turnId: string, nextLabel: string) => {
    if (!loadedSession || !loadedDraft) {
      return
    }

    if (!nextLabel.trim()) {
      removeBookmark(loadedSession.id, baseRevision, turnId)
      return
    }

    setBookmark(loadedSession.id, baseRevision, turnId, nextLabel)
  }

  const toggleTurn = (turnId: string) => {
    if (!loadedSession || !loadedDraft) {
      return
    }

    toggleTurnIncluded(loadedSession.id, baseRevision, turnId)
  }

  return (
    <SidebarProvider open={browserOpen} onOpenChange={setBrowserOpen}>
      <div className="app-root">
        <Sidebar aria-label="Session browser" collapsible="offcanvas">
          <BrowserPanel
            sessions={visibleSessions}
            selectedSessionId={selectedSessionId}
            searchText={searchText}
            onSearchTextChange={setSearchText}
            onSelectSession={handleSelectSession}
            onRefresh={handleRefresh}
            loading={sessionsLoading}
            refreshing={catalogRefreshing}
            error={sessionsError}
            notice={catalogNotice}
            summaryText={catalogSummary}
            emptyMessage={searchText ? 'No sessions match your query' : 'No sessions found'}
          />
        </Sidebar>

        <SidebarInset className="app-main">
          <main className="workspace-split">
            <section className="workspace-pane editor-pane">
              <section className="editor-shell">
                <header className="workspace-header">
                  <div className="workspace-header__copy">
                    <p className="eyebrow">Transcript draft</p>
                    <h2>Session edits</h2>
                  </div>
                  <div className="toolbar-grid">
                    {sessionLoading ? <span className="toolbar-chip">Loading selected session…</span> : null}
                    {sessionError ? <span className="toolbar-chip">{sessionError}</span> : null}
                    {!loadedSession && !sessionLoading ? (
                      <span className="toolbar-chip">Select session to begin</span>
                    ) : null}
                    {loadedSession ? <span className="toolbar-chip">Hide + bookmark now live in session playback</span> : null}
                    {!sessionsLoading && !sessionsError && !sessions.length ? (
                      <span className="toolbar-chip">No sessions discovered</span>
                    ) : null}
                  </div>
                </header>

                {loadedSession ? (
                  <div className="workspace-content">
                    <article className="summary-card summary-card--session">
                      <div className="summary-card__heading">
                        <div>
                          <p className="eyebrow">Current session</p>
                          <h3>{loadedSession.title}</h3>
                        </div>
                        <span className="summary-card__spark">
                          <Sparkles size={14} strokeWidth={1.8} />
                          Preview linked
                        </span>
                      </div>
                      <p>
                        {providerLabelMap[loadedSession.source] ?? loadedSession.source}
                        {loadedSession.project ? ` · ${loadedSession.project}` : null}
                      </p>
                      <p className="summary-meta">
                        <span>{materializedSession?.turns.length ?? 0} turns</span>
                        <span>{visibleTurnCount}/{totalTurnCount} visible</span>
                      </p>
                    </article>
                    <ul className="turn-strip">
                      {materializedSession?.turns.length ? (
                        materializedSession.turns.map((turn) => (
                          <li
                            key={turn.id}
                            className={`turn-strip__item ${turn.included === false ? 'is-hidden' : ''}`}
                          >
                            <div className="turn-strip__editor">
                              <p className="turn-strip__label">
                                {turn.blocks.length ? turn.blocks[0]?.title || roleForPreview(turn.role) : roleForPreview(turn.role)}
                                {turn.timestamp ? ` · ${formatTimeLabel(turn.timestamp)}` : ''}
                              </p>
                              {turn.blocks.map((block) => {
                                const value =
                                  block.type === 'tool'
                                    ? formatBlockEditorText(block)
                                    : loadedDraft?.blockTextEdits?.[turn.id]?.[block.id] ?? block.text

                                return (
                                  <textarea
                                    key={block.id}
                                    className="input turn-strip__textarea"
                                    disabled={block.type === 'tool'}
                                    rows={Math.min(8, Math.max(2, value.split('\n').length))}
                                    value={value}
                                    onChange={
                                      block.type === 'tool'
                                        ? undefined
                                        : (event) => handleBlockTextChange(turn.id, block.id, event.target.value)
                                    }
                                  />
                                )
                              })}
                            </div>
                          </li>
                        ))
                      ) : (
                        <li className="turn-strip__item">
                          <p className="turn-strip-empty">No turns available for this session</p>
                        </li>
                      )}
                    </ul>
                  </div>
                ) : (
                  <section className="workspace-content turn-strip-empty">
                    <p className="toolbar-chip">Select session to view and edit turns.</p>
                  </section>
                )}
              </section>
            </section>

            <section className="workspace-pane preview-pane">
              <section className="preview-workspace">
                <ReplayPanel
                  session={replaySession}
                  visibleCount={visibleTurnCount}
                  totalCount={totalTurnCount}
                  onBookmarkChange={handleBookmarkChange}
                  onToggleTurnIncluded={toggleTurn}
                />

                {previewError ? (
                  <section className="preview-block preview-block--status">
                    <div className="card__content">
                      <p className="preview-block__hint">Preview error: {previewError}</p>
                    </div>
                  </section>
                ) : null}

                {previewLoading ? (
                  <section className="preview-block preview-block--status">
                    <div className="card__content">
                      <p className="preview-block__hint">Rendering preview…</p>
                    </div>
                  </section>
                ) : null}

                {!previewLoading && !previewError && previewHtml ? (
                  <section className="card preview-frame-card">
                    <div className="card__content">
                      <iframe
                        className="preview-block__content preview-frame"
                        title="Replay preview"
                        srcDoc={previewHtml}
                      />
                    </div>
                  </section>
                ) : null}

                <ExportPanel
                  options={exportOptions}
                  canExport={Boolean(loadedSession) && Boolean(materializedSession)}
                  isExporting={exporting}
                  onOptionChange={handleExportOptionsChange}
                  onExport={handleExport}
                />
                {exportError ? <p className="export-footer__hint">Export error: {exportError}</p> : null}
              </section>
            </section>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

export default App
