import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPanel } from '../../src/features/browser/BrowserPanel'
import { type BrowserFilterOption, type BrowserProjectGroup } from '../../src/features/browser/model'
import { DEFAULT_FILTERS, type BrowserFilters } from '../../src/lib/browser/store'

const projectGroups: BrowserProjectGroup[] = [
  {
    agentSources: ['claude-code', 'codex'],
    latestUpdatedAt: Date.parse('2026-04-13T10:00:00.000Z'),
    projectKey: '/repo/session-replay',
    projectSubtitle: '/repo/session-replay',
    projectTitle: 'session-replay',
    sessions: [
      {
        agentLabel: 'Claude Code',
        cwd: '/repo/session-replay',
        hasCwd: true,
        hasPath: true,
        id: 'claude-1',
        projectKey: '/repo/session-replay',
        projectPath: '/repo/session-replay',
        projectSubtitle: '/repo/session-replay',
        projectTitle: 'session-replay',
        source: 'claude-code',
        title: 'Claude planning session',
        turnCount: 12,
        turnLength: 'medium',
        updatedAt: '2026-04-13T10:00:00.000Z',
        updatedAtLabel: '2 hours ago',
        updatedAtValue: Date.parse('2026-04-13T10:00:00.000Z'),
      },
      {
        agentLabel: 'Codex',
        cwd: '/repo/session-replay',
        hasCwd: true,
        hasPath: true,
        id: 'codex-1',
        projectKey: '/repo/session-replay',
        projectPath: '/repo/session-replay',
        projectSubtitle: '/repo/session-replay',
        projectTitle: 'session-replay',
        source: 'codex',
        title: 'Codex refactor session',
        turnCount: 8,
        turnLength: 'short',
        updatedAt: '2026-04-12T10:00:00.000Z',
        updatedAtLabel: 'yesterday',
        updatedAtValue: Date.parse('2026-04-12T10:00:00.000Z'),
      },
    ],
  },
  {
    agentSources: ['copilot'],
    latestUpdatedAt: Date.parse('2026-04-11T10:00:00.000Z'),
    projectKey: '/repo/other-project',
    projectSubtitle: '/repo/other-project',
    projectTitle: 'other-project',
    sessions: [
      {
        agentLabel: 'Copilot',
        cwd: '/repo/other-project',
        hasCwd: true,
        hasPath: true,
        id: 'copilot-1',
        projectKey: '/repo/other-project',
        projectPath: '/repo/other-project',
        projectSubtitle: '/repo/other-project',
        projectTitle: 'other-project',
        source: 'copilot',
        title: 'Copilot follow-up session',
        turnCount: 20,
        turnLength: 'long',
        updatedAt: '2026-04-11T10:00:00.000Z',
        updatedAtLabel: '3 days ago',
        updatedAtValue: Date.parse('2026-04-11T10:00:00.000Z'),
      },
    ],
  },
]

const agentOptions: BrowserFilterOption[] = [
  { id: 'claude-code', label: 'Claude Code', count: 1 },
  { id: 'codex', label: 'Codex', count: 1 },
  { id: 'copilot', label: 'Copilot', count: 1 },
]

const projectOptions: BrowserFilterOption[] = [
  { id: '/repo/session-replay', label: 'session-replay', subtitle: '/repo/session-replay', count: 2 },
  { id: '/repo/other-project', label: 'other-project', subtitle: '/repo/other-project', count: 1 },
]

function makeFilters(overrides: Partial<BrowserFilters> = {}): BrowserFilters {
  return {
    ...DEFAULT_FILTERS,
    ...overrides,
  }
}

function renderBrowserPanel(overrides: Partial<React.ComponentProps<typeof BrowserPanel>> = {}) {
  const props: React.ComponentProps<typeof BrowserPanel> = {
    activeFilterCount: 0,
    agentOptions,
    collapsedProjectIds: [],
    filters: makeFilters(),
    ignoredProjectOptions: [],
    pinnedProjectIds: [],
    projectGroups,
    projectOptions,
    selectedSessionId: null,
    searchText: '',
    onClearFilters: vi.fn(),
    onRefresh: vi.fn(),
    onRequireCwdChange: vi.fn(),
    onRequirePathChange: vi.fn(),
    onRestoreIgnoredProject: vi.fn(),
    onSearchTextChange: vi.fn(),
    onSelectSession: vi.fn(),
    onSetUpdatedWithin: vi.fn(),
    onToggleAgentFilter: vi.fn(),
    onToggleProjectCollapse: vi.fn(),
    onToggleProjectFilter: vi.fn(),
    onToggleProjectIgnore: vi.fn(),
    onToggleProjectPin: vi.fn(),
    onToggleTurnLength: vi.fn(),
    ...overrides,
  }

  render(<BrowserPanel {...props} />)
  return props
}

function getProjectTrigger(name: RegExp): HTMLElement {
  return screen
    .getAllByRole('button', { name })
    .find((element) => element.hasAttribute('aria-expanded')) as HTMLElement
}

describe('BrowserPanel', () => {
  it('expands the search field from the icon button and clears it when dismissed', async () => {
    const user = userEvent.setup()
    const onSearchTextChange = vi.fn()

    function ControlledBrowserPanel() {
      const [searchText, setSearchText] = React.useState('')

      return (
        <BrowserPanel
          activeFilterCount={0}
          agentOptions={agentOptions}
          collapsedProjectIds={[]}
          filters={makeFilters()}
          ignoredProjectOptions={[]}
          pinnedProjectIds={[]}
          projectGroups={projectGroups}
          projectOptions={projectOptions}
          selectedSessionId={null}
          searchText={searchText}
          onClearFilters={vi.fn()}
          onRefresh={vi.fn()}
          onRequireCwdChange={vi.fn()}
          onRequirePathChange={vi.fn()}
          onRestoreIgnoredProject={vi.fn()}
          onSearchTextChange={(value) => {
            onSearchTextChange(value)
            setSearchText(value)
          }}
          onSelectSession={vi.fn()}
          onSetUpdatedWithin={vi.fn()}
          onToggleAgentFilter={vi.fn()}
          onToggleProjectCollapse={vi.fn()}
          onToggleProjectFilter={vi.fn()}
          onToggleProjectIgnore={vi.fn()}
          onToggleProjectPin={vi.fn()}
          onToggleTurnLength={vi.fn()}
        />
      )
    }

    render(<ControlledBrowserPanel />)

    await user.click(screen.getByRole('button', { name: /^search sessions$/i }))

    const searchInput = screen.getByRole('textbox', { name: /search sessions/i })
    expect(searchInput).toHaveFocus()

    await user.type(searchInput, 'codex')

    expect(onSearchTextChange).toHaveBeenNthCalledWith(1, 'c')
    expect(onSearchTextChange).toHaveBeenLastCalledWith('codex')

    await user.keyboard('{Escape}')

    expect(onSearchTextChange).toHaveBeenLastCalledWith('')
  })

  it('marks the refresh button busy while a refresh is in progress', () => {
    renderBrowserPanel({ refreshing: true })

    expect(screen.getByRole('button', { name: /refresh sessions/i })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  it('keeps refresh busy long enough to show manual refresh feedback', async () => {
    const user = userEvent.setup()
    let resolveRefresh: (() => void) | null = null

    renderBrowserPanel({
      onRefresh: () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        }),
    })

    const refreshButton = screen.getByRole('button', { name: /refresh sessions/i })

    await user.click(refreshButton)
    expect(refreshButton).toHaveAttribute('aria-busy', 'true')

    resolveRefresh?.()
    await waitFor(() => {
      expect(refreshButton).toHaveAttribute('aria-busy', 'false')
    })
  })

  it('lets users collapse and expand project groups', async () => {
    const user = userEvent.setup()
    const onToggleProjectCollapse = vi.fn()

    const { rerender } = render(
      <BrowserPanel
        activeFilterCount={0}
        agentOptions={agentOptions}
        collapsedProjectIds={[]}
        filters={makeFilters()}
        ignoredProjectOptions={[]}
        pinnedProjectIds={[]}
        projectGroups={projectGroups}
        projectOptions={projectOptions}
        selectedSessionId={null}
        searchText=""
        onClearFilters={vi.fn()}
        onRefresh={vi.fn()}
        onRequireCwdChange={vi.fn()}
        onRequirePathChange={vi.fn()}
        onRestoreIgnoredProject={vi.fn()}
        onSearchTextChange={vi.fn()}
        onSelectSession={vi.fn()}
        onSetUpdatedWithin={vi.fn()}
        onToggleAgentFilter={vi.fn()}
        onToggleProjectCollapse={onToggleProjectCollapse}
        onToggleProjectFilter={vi.fn()}
        onToggleProjectIgnore={vi.fn()}
        onToggleProjectPin={vi.fn()}
        onToggleTurnLength={vi.fn()}
      />,
    )

    const projectTrigger = getProjectTrigger(/session-replay/i)
    expect(projectTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /claude planning session/i })).toBeInTheDocument()

    await user.click(projectTrigger)
    expect(onToggleProjectCollapse).toHaveBeenCalledWith('/repo/session-replay')

    rerender(
      <BrowserPanel
        activeFilterCount={0}
        agentOptions={agentOptions}
        collapsedProjectIds={['/repo/session-replay']}
        filters={makeFilters()}
        ignoredProjectOptions={[]}
        pinnedProjectIds={[]}
        projectGroups={projectGroups}
        projectOptions={projectOptions}
        selectedSessionId={null}
        searchText=""
        onClearFilters={vi.fn()}
        onRefresh={vi.fn()}
        onRequireCwdChange={vi.fn()}
        onRequirePathChange={vi.fn()}
        onRestoreIgnoredProject={vi.fn()}
        onSearchTextChange={vi.fn()}
        onSelectSession={vi.fn()}
        onSetUpdatedWithin={vi.fn()}
        onToggleAgentFilter={vi.fn()}
        onToggleProjectCollapse={onToggleProjectCollapse}
        onToggleProjectFilter={vi.fn()}
        onToggleProjectIgnore={vi.fn()}
        onToggleProjectPin={vi.fn()}
        onToggleTurnLength={vi.fn()}
      />,
    )

    expect(getProjectTrigger(/session-replay/i)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /claude planning session/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copilot follow-up session/i })).toBeInTheDocument()
  })

  it('opens the filter panel and wires filter and hidden-project actions', async () => {
    const user = userEvent.setup()
    const onToggleAgentFilter = vi.fn()
    const onToggleProjectFilter = vi.fn()
    const onSetUpdatedWithin = vi.fn()
    const onToggleTurnLength = vi.fn()
    const onRequireCwdChange = vi.fn()
    const onRequirePathChange = vi.fn()
    const onRestoreIgnoredProject = vi.fn()
    const onClearFilters = vi.fn()

    renderBrowserPanel({
      activeFilterCount: 3,
      filters: makeFilters({
        agentIds: ['copilot'],
        requireCwd: true,
        updatedWithin: '7d',
      }),
      ignoredProjectOptions: [
        {
          id: '/repo/hidden-project',
          label: 'hidden-project',
          subtitle: '/repo/hidden-project',
          count: 4,
        },
      ],
      onClearFilters,
      onRequireCwdChange,
      onRequirePathChange,
      onRestoreIgnoredProject,
      onSetUpdatedWithin,
      onToggleAgentFilter,
      onToggleProjectFilter,
      onToggleTurnLength,
    })

    await user.click(screen.getByRole('button', { name: /filter sessions/i }))
    const filterPanel = screen.getByText(/session filters/i).closest('article') as HTMLElement

    await user.click(within(filterPanel).getByRole('button', { name: /copilot/i }))
    expect(onToggleAgentFilter).toHaveBeenCalledWith('copilot')

    await user.click(within(filterPanel).getByRole('button', { name: /other-project/i }))
    expect(onToggleProjectFilter).toHaveBeenCalledWith('/repo/other-project')

    await user.click(within(filterPanel).getByRole('button', { name: /last 7d/i }))
    expect(onSetUpdatedWithin).toHaveBeenCalledWith('7d')

    await user.click(within(filterPanel).getByRole('button', { name: /^long$/i }))
    expect(onToggleTurnLength).toHaveBeenCalledWith('long')

    await user.click(within(filterPanel).getByRole('button', { name: /require cwd/i }))
    expect(onRequireCwdChange).toHaveBeenCalledWith(false)

    await user.click(within(filterPanel).getByRole('button', { name: /require path/i }))
    expect(onRequirePathChange).toHaveBeenCalledWith(true)

    await user.click(within(filterPanel).getByRole('button', { name: /hidden-project/i }))
    expect(onRestoreIgnoredProject).toHaveBeenCalledWith('/repo/hidden-project')

    await user.click(within(filterPanel).getByRole('button', { name: /clear all/i }))
    expect(onClearFilters).toHaveBeenCalled()
  })
})
