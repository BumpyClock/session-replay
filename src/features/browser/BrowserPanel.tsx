import {
  ChevronDown,
  Eye,
  EyeOff,
  FolderGit2,
  ListFilter,
  Pin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
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
import type { BrowserFilters, BrowserTurnLength, BrowserUpdatedWithin } from '../../lib/browser/store'
import { AgentIcon } from './AgentIcon'
import {
  type BrowserFilterOption,
  type BrowserProjectGroup,
  getSourceLabel,
  turnLengthLabels,
  updatedWithinLabels,
} from './model'

export type BrowserPanelProps = {
  activeFilterCount: number
  agentOptions: BrowserFilterOption[]
  collapsedProjectIds: string[]
  filters: BrowserFilters
  ignoredProjectOptions: BrowserFilterOption[]
  pinnedProjectIds: string[]
  projectGroups: BrowserProjectGroup[]
  projectOptions: BrowserFilterOption[]
  selectedSessionId: string | null
  searchText: string
  loading?: boolean
  refreshing?: boolean
  error?: string | null
  notice?: string | null
  summaryText?: string
  onClearFilters: () => void
  onRequireCwdChange: (required: boolean) => void
  onRequirePathChange: (required: boolean) => void
  onRestoreIgnoredProject: (projectId: string) => void
  onSearchTextChange: (value: string) => void
  onSetUpdatedWithin: (updatedWithin: BrowserUpdatedWithin) => void
  onSelectSession: (sessionId: string) => void
  onRefresh: () => void | Promise<void>
  onToggleAgentFilter: (agentId: string) => void
  onToggleProjectCollapse: (projectId: string) => void
  onToggleProjectFilter: (projectId: string) => void
  onToggleProjectIgnore: (projectId: string) => void
  onToggleProjectPin: (projectId: string) => void
  onToggleTurnLength: (turnLength: BrowserTurnLength) => void
  emptyMessage?: string
}

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

function projectContentId(projectKey: string): string {
  const sanitized = projectKey.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return `session-project-${sanitized.replace(/(^-+)|(-+$)/g, '') || 'group'}`
}

function BrowserPanel({
  activeFilterCount,
  agentOptions,
  collapsedProjectIds,
  filters,
  ignoredProjectOptions,
  pinnedProjectIds,
  projectGroups,
  projectOptions,
  selectedSessionId,
  searchText,
  loading = false,
  refreshing = false,
  error = null,
  notice = null,
  summaryText,
  onClearFilters,
  onRefresh,
  onRequireCwdChange,
  onRequirePathChange,
  onRestoreIgnoredProject,
  onSearchTextChange,
  onSelectSession,
  onSetUpdatedWithin,
  onToggleAgentFilter,
  onToggleProjectCollapse,
  onToggleProjectFilter,
  onToggleProjectIgnore,
  onToggleProjectPin,
  onToggleTurnLength,
  emptyMessage = 'No sessions found',
}: BrowserPanelProps) {
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [manualRefreshPending, setManualRefreshPending] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(() => Boolean(searchText.trim()))
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const filterTriggerRef = useRef<HTMLButtonElement>(null)
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

  useEffect(() => {
    if (!filterExpanded) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (
        filterPanelRef.current?.contains(target)
        || filterTriggerRef.current?.contains(target)
      ) {
        return
      }

      setFilterExpanded(false)
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFilterExpanded(false)
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    window.addEventListener('mousedown', handlePointerDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
      window.removeEventListener('mousedown', handlePointerDown)
    }
  }, [filterExpanded])

  const openSearch = () => {
    setFilterExpanded(false)
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
                    <p>{summaryText ?? `${projectGroups.length} projects loaded`}</p>
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

                    <div className="session-sidebar__filter-shell">
                      <Button
                        ref={filterTriggerRef}
                        size="sm"
                        variant="outline"
                        className="session-sidebar__icon-button session-sidebar__filter-trigger"
                        onClick={() => setFilterExpanded((current) => !current)}
                        aria-expanded={filterExpanded}
                        aria-controls="session-sidebar-filter-panel"
                        aria-label="Filter sessions"
                        title="Filter sessions"
                      >
                        <ListFilter size={14} strokeWidth={1.8} />
                        {activeFilterCount > 0 ? (
                          <span className="session-sidebar__filter-count">{activeFilterCount}</span>
                        ) : null}
                      </Button>

                      <AnimatePresence initial={false}>
                        {filterExpanded ? (
                          <motion.div
                            id="session-sidebar-filter-panel"
                            ref={filterPanelRef}
                            className="session-sidebar__filter-panel"
                            initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                            transition={toolbarFadeTransition}
                          >
                            <Card>
                              <CardHeader className="session-sidebar__filter-panel-header">
                                <div>
                                  <p className="eyebrow">Filters</p>
                                  <CardTitle>Session filters</CardTitle>
                                </div>
                                {activeFilterCount > 0 ? <Badge>{activeFilterCount} active</Badge> : null}
                              </CardHeader>
                              <CardContent className="session-sidebar__filter-panel-content">
                                <section className="session-sidebar__filter-section">
                                  <div className="session-sidebar__filter-section-heading">
                                    <SlidersHorizontal size={14} strokeWidth={1.8} />
                                    <span>Agents</span>
                                  </div>
                                  <div className="session-sidebar__filter-chip-grid">
                                    {agentOptions.map((option) => (
                                      <FilterChip
                                        key={option.id}
                                        active={filters.agentIds.includes(option.id)}
                                        label={option.label}
                                        count={option.count}
                                        onClick={() => onToggleAgentFilter(option.id)}
                                      />
                                    ))}
                                  </div>
                                </section>

                                <section className="session-sidebar__filter-section">
                                  <div className="session-sidebar__filter-section-heading">
                                    <FolderGit2 size={14} strokeWidth={1.8} />
                                    <span>Projects</span>
                                  </div>
                                  <div className="session-sidebar__filter-chip-grid session-sidebar__filter-chip-grid--stacked">
                                    {projectOptions.map((option) => (
                                      <FilterChip
                                        key={option.id}
                                        active={filters.projectIds.includes(option.id)}
                                        label={option.label}
                                        subtitle={option.subtitle}
                                        count={option.count}
                                        onClick={() => onToggleProjectFilter(option.id)}
                                      />
                                    ))}
                                  </div>
                                </section>

                                <section className="session-sidebar__filter-section">
                                  <div className="session-sidebar__filter-section-heading">
                                    <span>Updated</span>
                                  </div>
                                  <div className="session-sidebar__filter-chip-grid">
                                    {(Object.entries(updatedWithinLabels) as [BrowserUpdatedWithin, string][]).map(
                                      ([value, label]) => (
                                        <FilterChip
                                          key={value}
                                          active={filters.updatedWithin === value}
                                          label={label}
                                          onClick={() => onSetUpdatedWithin(value)}
                                        />
                                      ),
                                    )}
                                  </div>
                                </section>

                                <section className="session-sidebar__filter-section">
                                  <div className="session-sidebar__filter-section-heading">
                                    <span>Length</span>
                                  </div>
                                  <div className="session-sidebar__filter-chip-grid">
                                    {(Object.entries(turnLengthLabels) as [BrowserTurnLength, string][]).map(
                                      ([value, label]) => (
                                        <FilterChip
                                          key={value}
                                          active={filters.turnLengths.includes(value)}
                                          label={label}
                                          onClick={() => onToggleTurnLength(value)}
                                        />
                                      ),
                                    )}
                                  </div>
                                </section>

                                <section className="session-sidebar__filter-section">
                                  <div className="session-sidebar__filter-section-heading">
                                    <span>Metadata</span>
                                  </div>
                                  <div className="session-sidebar__toggle-list">
                                    <FilterToggle
                                      checked={filters.requireCwd}
                                      label="Require cwd"
                                      onChange={() => onRequireCwdChange(!filters.requireCwd)}
                                    />
                                    <FilterToggle
                                      checked={filters.requirePath}
                                      label="Require path"
                                      onChange={() => onRequirePathChange(!filters.requirePath)}
                                    />
                                  </div>
                                </section>

                                {ignoredProjectOptions.length > 0 ? (
                                  <section className="session-sidebar__filter-section">
                                    <div className="session-sidebar__filter-section-heading">
                                      <EyeOff size={14} strokeWidth={1.8} />
                                      <span>Hidden projects</span>
                                    </div>
                                    <div className="session-sidebar__hidden-projects">
                                      {ignoredProjectOptions.map((option) => (
                                        <button
                                          key={option.id}
                                          type="button"
                                          className="session-sidebar__hidden-project-row"
                                          onClick={() => onRestoreIgnoredProject(option.id)}
                                        >
                                          <span>
                                            <strong>{option.label}</strong>
                                            {option.subtitle ? <small>{option.subtitle}</small> : null}
                                          </span>
                                          <span className="session-sidebar__hidden-project-action">
                                            <Eye size={14} strokeWidth={1.8} />
                                            Restore
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  </section>
                                ) : null}
                              </CardContent>
                              <CardFooter className="session-sidebar__filter-panel-footer">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={onClearFilters}
                                  disabled={activeFilterCount === 0}
                                >
                                  Clear all
                                </Button>
                              </CardFooter>
                            </Card>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>

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
                      placeholder="Search project, agent, path, title"
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
        ) : projectGroups.length === 0 ? (
          <p className="session-sidebar__empty">{emptyMessage}</p>
        ) : (
          projectGroups.map((group) => {
            const contentId = projectContentId(group.projectKey)
            const isCollapsed = collapsedProjectIds.includes(group.projectKey)
            const isPinned = pinnedProjectIds.includes(group.projectKey)

            return (
              <SidebarGroup className="session-sidebar__group" key={group.projectKey}>
                <SidebarGroupLabel className="session-sidebar__group-label">
                  <div className="session-sidebar__group-header">
                    <button
                      type="button"
                      className="session-sidebar__group-trigger"
                      aria-controls={contentId}
                      aria-expanded={!isCollapsed}
                      onClick={() => onToggleProjectCollapse(group.projectKey)}
                    >
                      <span className="session-sidebar__group-copy">
                        <span className="session-sidebar__group-title">
                          <ChevronDown
                            size={12}
                            strokeWidth={1.8}
                            className="session-sidebar__group-chevron"
                          />
                          {group.projectTitle}
                        </span>
                        {group.projectSubtitle ? (
                          <span className="session-sidebar__group-subtitle">{group.projectSubtitle}</span>
                        ) : null}
                        <span className="session-sidebar__group-agents">
                          {group.agentSources.map((source) => (
                            <span
                              key={source}
                              className="session-sidebar__group-agent"
                              title={getSourceLabel(source)}
                            >
                              <AgentIcon source={source} />
                            </span>
                          ))}
                        </span>
                      </span>
                      <Badge>{group.sessions.length}</Badge>
                    </button>
                    <div className="session-sidebar__group-actions">
                      <Button
                        size="xs"
                        variant="ghost"
                        className={`session-sidebar__group-action ${isPinned ? 'is-active' : ''}`}
                        aria-label={isPinned ? `Unpin ${group.projectTitle}` : `Pin ${group.projectTitle}`}
                        aria-pressed={isPinned}
                        onClick={() => onToggleProjectPin(group.projectKey)}
                        title={isPinned ? 'Unpin project' : 'Pin project'}
                      >
                        <Pin size={13} strokeWidth={1.8} />
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="session-sidebar__group-action"
                        aria-label={`Hide ${group.projectTitle}`}
                        onClick={() => onToggleProjectIgnore(group.projectKey)}
                        title="Hide project"
                      >
                        <EyeOff size={13} strokeWidth={1.8} />
                      </Button>
                    </div>
                  </div>
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
                            <span className="session-sidebar__session-meta">
                              <span className="session-sidebar__session-agent">
                                <AgentIcon source={session.source} />
                                <span>{session.agentLabel}</span>
                              </span>
                              <span className="session-sidebar__session-turns">{session.turnCount} turns</span>
                              <span className="session-sidebar__session-updated">{session.updatedAtLabel}</span>
                            </span>
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

type FilterChipProps = {
  active: boolean
  count?: number
  label: string
  subtitle?: string
  onClick: () => void
}

function FilterChip({ active, count, label, subtitle, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      className={`session-sidebar__filter-chip ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="session-sidebar__filter-chip-copy">
        <span>{label}</span>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      {typeof count === 'number' ? <Badge>{count}</Badge> : null}
    </button>
  )
}

type FilterToggleProps = {
  checked: boolean
  label: string
  onChange: () => void
}

function FilterToggle({ checked, label, onChange }: FilterToggleProps) {
  return (
    <button
      type="button"
      className={`session-sidebar__filter-toggle ${checked ? 'is-active' : ''}`}
      aria-pressed={checked}
      onClick={onChange}
    >
      <span>{label}</span>
      <Badge>{checked ? 'On' : 'Off'}</Badge>
    </button>
  )
}

export { BrowserPanel }
