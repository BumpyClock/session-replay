import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserPanel } from './features/browser/BrowserPanel'
import {
  countActiveFilters,
  createAgentFilterOptions,
  createBrowserSessionRows,
  createProjectFilterOptions,
  createProjectGroups,
  filterBrowserSessionRows,
  getSourceLabel,
} from './features/browser/model'
import { ReplayPanel } from './features/preview/ReplayPanel'
import type { PreviewTurn, ReplaySession } from './features/preview/ReplayPanel'
import { ExportPreviewDialog } from './features/export/ExportPreviewDialog'
import { ExportPanel, type ExportOptions } from './features/export/ExportPanel'
import { createSessionReplayApiClient as createApiClient } from './lib/api'
import { useBrowserPrefsStore } from './lib/browser/store'
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
import { Sidebar, SidebarInset, SidebarProvider } from './components/ui/sidebar'

const defaultFileNameFor = (session: Pick<SessionRef, 'id' | 'title'>): string => {
  const base = session.title?.trim() || session.id || 'agent-session-replay'
  const sanitized = base.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return sanitized.replace(/(^-+)|(-+$)/g, '') || 'agent-session-replay'
}

const roleForPreview = (role: ReplayRole): PreviewTurn['role'] => {
  if (role === 'user') {
    return 'user'
  }

  if (role === 'system') {
    return 'system'
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

/** Maps the normalized replay payload into the lighter-weight playback view model. */
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
    provider: getSourceLabel(session.source),
    project: session.project ?? 'Unknown project',
    cwd: session.cwd ?? '',
    title: session.title,
    updatedAt: session.updatedAt ?? '',
    turnCount: turns.length,
    turns,
  }
}

/** Resolves the API base so production exports can still talk to the local server. */
function resolveApiClient() {
  const explicit = import.meta.env.VITE_SESSION_REPLAY_API_BASE
  const baseUrl = import.meta.env.DEV ? explicit ?? '' : explicit ?? 'http://127.0.0.1:4848'

  return createApiClient(baseUrl)
}

/** Summarizes partial catalog failures without blocking healthy sessions. */
function formatCatalogNotice(warnings: readonly SessionWarning[]): string | null {
  if (warnings.length === 0) {
    return null
  }

  const label = warnings.length === 1 ? 'session was' : 'sessions were'
  return `${warnings.length} ${label} skipped during catalog refresh. Check console for paths.`
}

/** Keeps the sidebar summary stable while background indexing refreshes run. */
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
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false)
  const pollingRequestInFlight = useRef(false)

  const browserFilters = useBrowserPrefsStore((state) => state.filters)
  const collapsedProjectIds = useBrowserPrefsStore((state) => state.collapsedProjectIds)
  const pinnedProjectIds = useBrowserPrefsStore((state) => state.pinnedProjectIds)
  const ignoredProjectIds = useBrowserPrefsStore((state) => state.ignoredProjectIds)
  const clearBrowserFilters = useBrowserPrefsStore((state) => state.clearFilters)
  const restoreIgnoredProject = useBrowserPrefsStore((state) => state.restoreIgnoredProject)
  const setRequireCwd = useBrowserPrefsStore((state) => state.setRequireCwd)
  const setRequirePath = useBrowserPrefsStore((state) => state.setRequirePath)
  const setUpdatedWithin = useBrowserPrefsStore((state) => state.setUpdatedWithin)
  const toggleAgentFilter = useBrowserPrefsStore((state) => state.toggleAgentFilter)
  const toggleCollapsedProject = useBrowserPrefsStore((state) => state.toggleCollapsedProject)
  const toggleIgnoredProject = useBrowserPrefsStore((state) => state.toggleIgnoredProject)
  const togglePinnedProject = useBrowserPrefsStore((state) => state.togglePinnedProject)
  const toggleProjectFilter = useBrowserPrefsStore((state) => state.toggleProjectFilter)
  const toggleTurnLength = useBrowserPrefsStore((state) => state.toggleTurnLength)

  const ensureDraft = useEditorStore((state) => state.ensureDraft)
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

  const browserRows = useMemo(() => createBrowserSessionRows(sessions), [sessions])
  const visibleBrowserRows = useMemo(
    () => filterBrowserSessionRows(browserRows, searchText, browserFilters, ignoredProjectIds),
    [browserFilters, browserRows, ignoredProjectIds, searchText],
  )
  const projectGroups = useMemo(
    () => createProjectGroups(visibleBrowserRows, pinnedProjectIds),
    [pinnedProjectIds, visibleBrowserRows],
  )
  const agentOptions = useMemo(() => createAgentFilterOptions(browserRows), [browserRows])
  const projectOptions = useMemo(() => createProjectFilterOptions(browserRows), [browserRows])
  const ignoredProjectOptions = useMemo(
    () => projectOptions.filter((option) => ignoredProjectIds.includes(option.id)),
    [ignoredProjectIds, projectOptions],
  )
  const activeFilterCount = useMemo(() => countActiveFilters(browserFilters), [browserFilters])
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

  const materializedSession = useMemo(
    () => (loadedSession ? materializeReplaySession(loadedSession, loadedDraft) : null),
    [loadedDraft, loadedSession],
  )
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

    // Only draft fields that affect rendered export output belong in this signature.
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
      setExportError(null)
      setExportSettingsOpen(false)
      setLoadedSession(null)
      setPreviewOpen(false)
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
      setExportSettingsOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed'
      setExportError(message)
      setExportSettingsOpen(true)
    } finally {
      setExporting(false)
    }
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

  const canExport = Boolean(loadedSession) && Boolean(materializedSession)

  return (
    <SidebarProvider open={browserOpen} onOpenChange={setBrowserOpen}>
      <div className="app-root">
        <Sidebar aria-label="Session browser" collapsible="offcanvas">
          <BrowserPanel
            activeFilterCount={activeFilterCount}
            agentOptions={agentOptions}
            collapsedProjectIds={collapsedProjectIds}
            filters={browserFilters}
            ignoredProjectOptions={ignoredProjectOptions}
            pinnedProjectIds={pinnedProjectIds}
            projectGroups={projectGroups}
            projectOptions={projectOptions}
            selectedSessionId={selectedSessionId}
            searchText={searchText}
            emptyMessage={
              searchText || activeFilterCount > 0
                ? 'No sessions match your current search or filters'
                : 'No sessions found'
            }
            error={sessionsError}
            loading={sessionsLoading}
            notice={catalogNotice}
            onClearFilters={clearBrowserFilters}
            onRefresh={handleRefresh}
            onRequireCwdChange={setRequireCwd}
            onRequirePathChange={setRequirePath}
            onRestoreIgnoredProject={restoreIgnoredProject}
            onSearchTextChange={setSearchText}
            onSelectSession={handleSelectSession}
            onSetUpdatedWithin={setUpdatedWithin}
            onToggleAgentFilter={toggleAgentFilter}
            onToggleProjectCollapse={toggleCollapsedProject}
            onToggleProjectFilter={toggleProjectFilter}
            onToggleProjectIgnore={toggleIgnoredProject}
            onToggleProjectPin={togglePinnedProject}
            onToggleTurnLength={toggleTurnLength}
            refreshing={catalogRefreshing}
            summaryText={catalogSummary}
          />
        </Sidebar>

        <SidebarInset className="app-main">
          <main className="preview-workspace app-main__preview">
            {sessionLoading || sessionError || (!sessionsLoading && !sessionsError && !sessions.length) ? (
              <div className="toolbar-grid" aria-live="polite">
                {sessionLoading ? <span className="toolbar-chip">Loading selected session…</span> : null}
                {sessionError ? <span className="toolbar-chip">{sessionError}</span> : null}
                {!sessionsLoading && !sessionsError && !sessions.length ? (
                  <span className="toolbar-chip">No sessions discovered</span>
                ) : null}
              </div>
            ) : null}
            <ReplayPanel
              canExport={canExport}
              isExporting={exporting}
              onExport={() => {
                void handleExport()
              }}
              session={replaySession}
              visibleCount={visibleTurnCount}
              totalCount={totalTurnCount}
              onBookmarkChange={handleBookmarkChange}
              onOpenExportSettings={() => setExportSettingsOpen(true)}
              onOpenPreview={() => setPreviewOpen(true)}
              onToggleTurnIncluded={toggleTurn}
            />
          </main>
          <ExportPreviewDialog
            isOpen={previewOpen}
            onOpenChange={setPreviewOpen}
            previewError={previewError}
            previewHtml={previewHtml}
            previewLoading={previewLoading}
          />
          <ExportPanel
            options={exportOptions}
            canExport={canExport}
            error={exportError}
            isOpen={exportSettingsOpen}
            onOpenChange={setExportSettingsOpen}
            onOptionChange={handleExportOptionsChange}
          />
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

export default App
