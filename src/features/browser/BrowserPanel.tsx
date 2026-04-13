import { ChevronDown, FolderGit2, RefreshCw, Search, X } from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../../components/ui/sidebar'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'

export type SessionSummary = {
  id: string
  provider: string
  project: string
  title: string
  cwd: string
  updatedAt: string
  turnCount: number
}

export type BrowserPanelProps = {
  sessions: SessionSummary[]
  selectedSessionId: string | null
  searchText: string
  loading?: boolean
  refreshing?: boolean
  error?: string | null
  notice?: string | null
  summaryText?: string
  onSearchTextChange: (value: string) => void
  onSelectSession: (sessionId: string) => void
  onRefresh: () => void | Promise<void>
  emptyMessage?: string
}

const providerOrder = ['Claude Code', 'Codex', 'Copilot', 'Cursor', 'Gemini']
const minimumRefreshSpinMs = 560
const searchMorphTransition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.82,
} as const

const toolbarFadeTransition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
} as const

function sessionByProvider(sessions: SessionSummary[]) {
  const buckets = new Map<string, SessionSummary[]>()
  for (const session of sessions) {
    const existing = buckets.get(session.provider) ?? []
    buckets.set(session.provider, [...existing, session])
  }
  return providerOrder
    .filter((provider) => buckets.has(provider))
    .map((provider) => ({
      provider,
      sessions: buckets.get(provider) ?? [],
    }))
    .concat(
      [...buckets.entries()]
        .filter((entry) => !providerOrder.includes(entry[0]))
        .map(([provider, list]) => ({ provider, sessions: list })),
    )
}

function providerContentId(provider: string): string {
  const sanitized = provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return `session-provider-${sanitized.replace(/(^-+)|(-+$)/g, '') || 'group'}`
}

function BrowserPanel({
  sessions,
  selectedSessionId,
  searchText,
  onSearchTextChange,
  onSelectSession,
  onRefresh,
  loading = false,
  refreshing = false,
  error = null,
  notice = null,
  summaryText,
  emptyMessage = 'No sessions found',
}: BrowserPanelProps) {
  const groups = useMemo(() => sessionByProvider(sessions), [sessions])
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, true>>({})
  const [manualRefreshPending, setManualRefreshPending] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(() => Boolean(searchText.trim()))
  const searchInputRef = useRef<HTMLInputElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const refreshActive = refreshing || manualRefreshPending

  useEffect(() => {
    if (searchText.trim()) {
      setSearchExpanded(true)
    }
  }, [searchText])

  useEffect(() => {
    if (!searchExpanded) {
      return
    }

    searchInputRef.current?.focus()
  }, [searchExpanded])

  const toggleProvider = (provider: string) => {
    setCollapsedProviders((current) => {
      if (current[provider]) {
        const next = { ...current }
        delete next[provider]
        return next
      }

      return {
        ...current,
        [provider]: true,
      }
    })
  }

  const openSearch = () => {
    setSearchExpanded(true)
  }

  const closeSearch = () => {
    setSearchExpanded(false)
    onSearchTextChange('')
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') {
      return
    }

    event.preventDefault()
    closeSearch()
  }

  const handleRefreshClick = async () => {
    if (manualRefreshPending) {
      return
    }

    const startedAt = Date.now()
    setManualRefreshPending(true)

    try {
      await onRefresh()
    } finally {
      const elapsed = Date.now() - startedAt
      const remaining = minimumRefreshSpinMs - elapsed

      if (remaining > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, remaining)
        })
      }

      setManualRefreshPending(false)
    }
  }

  return (
    <>
      <SidebarHeader className="session-sidebar__header">
        <div className="session-sidebar__title">
          <p className="eyebrow">Session browser</p>
          <h2>Replay library</h2>
        </div>
        <LayoutGroup id="session-sidebar-toolbar">
          <div className="session-sidebar__toolbar">
            <AnimatePresence initial={false}>
              {!searchExpanded ? (
                <motion.div
                  key="session-sidebar-toolbar-base"
                  className="session-sidebar__toolbar-base"
                  initial={false}
                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                  exit={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, x: -14, filter: 'blur(6px)' }
                  }
                  transition={toolbarFadeTransition}
                >
                  <div className="session-sidebar__summary">
                    <FolderGit2 size={14} strokeWidth={1.8} />
                    <p>{summaryText ?? `${sessions.length} sessions loaded`}</p>
                  </div>
                  <div className="session-sidebar__toolbar-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      className="session-sidebar__icon-button session-sidebar__refresh"
                      onClick={() => {
                        void handleRefreshClick()
                      }}
                      aria-label="Refresh sessions"
                      aria-busy={refreshActive}
                      title="Refresh sessions"
                    >
                      <motion.span
                        className="session-sidebar__refresh-icon"
                        animate={
                          refreshActive && !prefersReducedMotion ? { rotate: 360 } : { rotate: 0 }
                        }
                        transition={
                          refreshActive && !prefersReducedMotion
                            ? {
                                duration: 0.9,
                                ease: 'linear',
                                repeat: Infinity,
                              }
                            : {
                                duration: 0.2,
                                ease: [0.22, 1, 0.36, 1],
                              }
                        }
                      >
                        <RefreshCw size={14} strokeWidth={1.8} />
                      </motion.span>
                    </Button>

                    <motion.div
                      layoutId="session-sidebar-search-control"
                      className="session-sidebar__search-trigger-shell"
                      transition={prefersReducedMotion ? { duration: 0 } : searchMorphTransition}
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="session-sidebar__icon-button session-sidebar__search-trigger"
                        onClick={openSearch}
                        aria-label="Search sessions"
                        aria-expanded={searchExpanded}
                        aria-controls="session-sidebar-search-input"
                        title="Search sessions"
                      >
                        <Search size={14} strokeWidth={1.8} />
                      </Button>
                    </motion.div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {searchExpanded ? (
                <motion.div
                  key="session-sidebar-search-shell"
                  layoutId="session-sidebar-search-control"
                  className="session-sidebar__search-shell"
                  transition={prefersReducedMotion ? { duration: 0 } : searchMorphTransition}
                >
                  <motion.div
                    className="session-sidebar__search-shell-inner"
                    initial={prefersReducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={toolbarFadeTransition}
                  >
                    <span className="session-sidebar__search-icon" aria-hidden="true">
                      <Search size={14} strokeWidth={1.8} />
                    </span>
                    <Input
                      id="session-sidebar-search-input"
                      ref={searchInputRef}
                      value={searchText}
                      onChange={(event) => onSearchTextChange(event.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Search provider, project, path, title"
                      aria-label="Search sessions"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="session-sidebar__icon-button session-sidebar__search-close"
                      onClick={closeSearch}
                      aria-label="Close search"
                      title="Close search"
                    >
                      <X size={14} strokeWidth={1.8} />
                    </Button>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </SidebarHeader>

      <SidebarContent className="session-sidebar__content">
        {!error && notice ? <p className="session-sidebar__notice">{notice}</p> : null}
        {error ? (
          <p className="session-sidebar__empty">Error: {error}</p>
        ) : loading ? (
          <p className="session-sidebar__empty">Loading sessions…</p>
        ) : groups.length === 0 ? (
          <p className="session-sidebar__empty">{emptyMessage}</p>
        ) : (
          groups.map((group) => {
            const contentId = providerContentId(group.provider)
            const isCollapsed = collapsedProviders[group.provider] ?? false

            return (
              <SidebarGroup className="session-sidebar__group" key={group.provider}>
                <SidebarGroupLabel className="session-sidebar__group-label">
                  <button
                    type="button"
                    className="session-sidebar__group-trigger"
                    aria-controls={contentId}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleProvider(group.provider)}
                  >
                    <span className="session-sidebar__group-title">
                      <ChevronDown
                        size={12}
                        strokeWidth={1.8}
                        className="session-sidebar__group-chevron"
                      />
                      {group.provider}
                    </span>
                    <Badge>{group.sessions.length}</Badge>
                  </button>
                </SidebarGroupLabel>
                {!isCollapsed ? (
                  <SidebarGroupContent id={contentId}>
                    <SidebarMenu>
                      {group.sessions.map((session) => (
                        <SidebarMenuItem key={session.id}>
                          <SidebarMenuButton
                            aria-current={selectedSessionId === session.id ? 'page' : undefined}
                            aria-selected={selectedSessionId === session.id}
                            isActive={selectedSessionId === session.id}
                            onClick={() => onSelectSession(session.id)}
                          >
                            <span className="session-sidebar__session-title">{session.title}</span>
                            <span className="session-sidebar__session-project">{session.project}</span>
                            <span className="session-sidebar__session-updated">{session.updatedAt}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                ) : null}
              </SidebarGroup>
            )
          })
        )}
      </SidebarContent>

    </>
  )
}

export { BrowserPanel }
