import { ChevronDown, FolderGit2, RefreshCw, Search } from 'lucide-react'
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
  error?: string | null
  onSearchTextChange: (value: string) => void
  onSelectSession: (sessionId: string) => void
  onRefresh: () => void
  emptyMessage?: string
}

const providerOrder = ['Claude Code', 'Codex', 'Copilot', 'Cursor', 'Gemini']

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

function BrowserPanel({
  sessions,
  selectedSessionId,
  searchText,
  onSearchTextChange,
  onSelectSession,
  onRefresh,
  loading = false,
  error = null,
  emptyMessage = 'No sessions found',
}: BrowserPanelProps) {
  const groups = sessionByProvider(sessions)

  return (
    <>
      <SidebarHeader className="session-sidebar__header">
        <div className="session-sidebar__title">
          <p className="eyebrow">Session browser</p>
          <h2>Replay library</h2>
        </div>
        <div className="session-sidebar__summary">
          <FolderGit2 size={14} strokeWidth={1.8} />
          <p>{sessions.length} sessions loaded</p>
          <Button
            size="sm"
            variant="outline"
            className="session-sidebar__refresh"
            onClick={onRefresh}
            aria-label="Refresh sessions"
            title="Refresh sessions"
          >
            <RefreshCw size={14} strokeWidth={1.8} />
          </Button>
        </div>
        <div className="session-sidebar__search">
          <Search size={14} strokeWidth={1.8} className="session-sidebar__search-icon" />
          <Input
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="Search provider, project, path, title"
            aria-label="Search sessions"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="session-sidebar__content">
        {error ? (
          <p className="session-sidebar__empty">Error: {error}</p>
        ) : loading ? (
          <p className="session-sidebar__empty">Loading sessions…</p>
        ) : groups.length === 0 ? (
          <p className="session-sidebar__empty">{emptyMessage}</p>
        ) : (
          groups.map((group) => (
            <SidebarGroup className="session-sidebar__group" key={group.provider}>
              <SidebarGroupLabel className="session-sidebar__group-label">
                <span className="session-sidebar__group-title">
                  <ChevronDown size={12} strokeWidth={1.8} />
                  {group.provider}
                </span>
                <Badge>{group.sessions.length}</Badge>
              </SidebarGroupLabel>
              <SidebarGroupContent>
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
            </SidebarGroup>
          ))
        )}
      </SidebarContent>

    </>
  )
}

export { BrowserPanel }
