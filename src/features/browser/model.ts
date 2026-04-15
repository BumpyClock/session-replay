import type { SessionRef } from '../../lib/api/contracts'
import type { BrowserFilters, BrowserTurnLength, BrowserUpdatedWithin } from '../../lib/browser/store'

export type BrowserSessionRow = {
  agentLabel: string
  cwd: string
  hasCwd: boolean
  hasPath: boolean
  id: string
  projectKey: string
  projectPath: string
  projectSubtitle: string
  projectTitle: string
  source: string
  title: string
  turnCount: number
  turnLength: BrowserTurnLength
  updatedAt: string
  updatedAtLabel: string
  updatedAtValue: number
}

export type BrowserProjectGroup = {
  agentSources: string[]
  latestUpdatedAt: number
  projectKey: string
  projectSubtitle: string
  projectTitle: string
  sessions: BrowserSessionRow[]
}

export type BrowserFilterOption = {
  count: number
  id: string
  label: string
  subtitle?: string
}

const sourceLabelMap: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  gemini: 'Gemini',
}

const sourceOrder = ['claude-code', 'codex', 'copilot', 'cursor', 'gemini']

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export const updatedWithinLabels: Record<BrowserUpdatedWithin, string> = {
  all: 'Any time',
  today: 'Last 24h',
  '7d': 'Last 7d',
  '30d': 'Last 30d',
  older: 'Older',
}

export const turnLengthLabels: Record<BrowserTurnLength, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
}

export function createBrowserSessionRows(
  sessions: SessionRef[],
  nowMs: number = Date.now(),
): BrowserSessionRow[] {
  return sessions
    .map((session) => {
      const updatedAtValue = parseTimestamp(session.updatedAt)
      const projectPath = getProjectPath(session)
      const projectTitle = getProjectLeaf(projectPath)
      const projectSubtitle = getProjectSubtitle(projectPath, projectTitle)

      return {
        agentLabel: getSourceLabel(session.source),
        cwd: session.cwd ?? '',
        hasCwd: Boolean(session.cwd),
        hasPath: Boolean(session.path),
        id: session.id,
        projectKey: normalizeProjectKey(projectPath),
        projectPath,
        projectSubtitle,
        projectTitle,
        source: session.source,
        title: session.title,
        turnCount: session.stats?.turnCount ?? 0,
        turnLength: getTurnLengthBucket(session.stats?.turnCount ?? 0),
        updatedAt: session.updatedAt ?? '',
        updatedAtLabel: formatRelativeTimeLabel(session.updatedAt, nowMs),
        updatedAtValue,
      }
    })
    .sort((left, right) => compareRowsByRecency(left, right))
}

export function filterBrowserSessionRows(
  rows: BrowserSessionRow[],
  query: string,
  filters: BrowserFilters,
  ignoredProjectIds: string[],
  nowMs: number = Date.now(),
): BrowserSessionRow[] {
  const normalizedQuery = query.trim().toLowerCase()

  return rows.filter((row) => {
    if (ignoredProjectIds.includes(row.projectKey)) {
      return false
    }

    if (filters.agentIds.length > 0 && !filters.agentIds.includes(row.source)) {
      return false
    }

    if (filters.projectIds.length > 0 && !filters.projectIds.includes(row.projectKey)) {
      return false
    }

    if (filters.turnLengths.length > 0 && !filters.turnLengths.includes(row.turnLength)) {
      return false
    }

    if (filters.requireCwd && !row.hasCwd) {
      return false
    }

    if (filters.requirePath && !row.hasPath) {
      return false
    }

    if (!matchesUpdatedWithin(row.updatedAtValue, filters.updatedWithin, nowMs)) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    const haystack = [
      row.agentLabel,
      row.cwd,
      row.projectPath,
      row.projectSubtitle,
      row.projectTitle,
      row.source,
      row.title,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })
}

export function createProjectGroups(
  rows: BrowserSessionRow[],
  pinnedProjectIds: string[],
): BrowserProjectGroup[] {
  const groups = new Map<string, BrowserProjectGroup>()

  for (const row of rows) {
    const existing = groups.get(row.projectKey)

    if (!existing) {
      groups.set(row.projectKey, {
        agentSources: [row.source],
        latestUpdatedAt: row.updatedAtValue,
        projectKey: row.projectKey,
        projectSubtitle: row.projectSubtitle,
        projectTitle: row.projectTitle,
        sessions: [row],
      })
      continue
    }

    existing.latestUpdatedAt = Math.max(existing.latestUpdatedAt, row.updatedAtValue)
    if (!existing.agentSources.includes(row.source)) {
      existing.agentSources.push(row.source)
    }
    existing.sessions.push(row)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      agentSources: sortSources(group.agentSources),
      sessions: [...group.sessions].sort(compareRowsByRecency),
    }))
    .sort((left, right) => {
      const leftPinned = pinnedProjectIds.includes(left.projectKey)
      const rightPinned = pinnedProjectIds.includes(right.projectKey)

      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1
      }

      if (left.latestUpdatedAt !== right.latestUpdatedAt) {
        return right.latestUpdatedAt - left.latestUpdatedAt
      }

      return left.projectTitle.localeCompare(right.projectTitle)
    })
}

export function createAgentFilterOptions(rows: BrowserSessionRow[]): BrowserFilterOption[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1)
  }

  return sortSources([...counts.keys()]).map((source) => ({
    count: counts.get(source) ?? 0,
    id: source,
    label: getSourceLabel(source),
  }))
}

export function createProjectFilterOptions(rows: BrowserSessionRow[]): BrowserFilterOption[] {
  const groups = new Map<string, BrowserFilterOption>()

  for (const row of rows) {
    const existing = groups.get(row.projectKey)
    if (existing) {
      existing.count += 1
      continue
    }

    groups.set(row.projectKey, {
      count: 1,
      id: row.projectKey,
      label: row.projectTitle,
      subtitle: row.projectSubtitle,
    })
  }

  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label))
}

export function countActiveFilters(filters: BrowserFilters): number {
  return filters.agentIds.length
    + filters.projectIds.length
    + filters.turnLengths.length
    + (filters.updatedWithin === 'all' ? 0 : 1)
    + (filters.requireCwd ? 1 : 0)
    + (filters.requirePath ? 1 : 0)
}

export function getSourceLabel(source: string): string {
  return sourceLabelMap[source] ?? source
}

function compareRowsByRecency(left: BrowserSessionRow, right: BrowserSessionRow): number {
  if (left.updatedAtValue !== right.updatedAtValue) {
    return right.updatedAtValue - left.updatedAtValue
  }

  return left.title.localeCompare(right.title)
}

function formatRelativeTimeLabel(timestamp?: string | null, nowMs: number = Date.now()): string {
  if (!timestamp) {
    return 'Unknown time'
  }

  const updatedAtValue = parseTimestamp(timestamp)
  if (updatedAtValue === 0) {
    return timestamp
  }

  const diffSeconds = Math.round((updatedAtValue - nowMs) / 1000)
  const absoluteSeconds = Math.abs(diffSeconds)

  if (absoluteSeconds < 60) {
    return 'just now'
  }

  if (absoluteSeconds < 60 * 60) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / 60), 'minute')
  }

  if (absoluteSeconds < 60 * 60 * 24) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60)), 'hour')
  }

  if (absoluteSeconds < 60 * 60 * 24 * 30) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60 * 24)), 'day')
  }

  if (absoluteSeconds < 60 * 60 * 24 * 365) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60 * 24 * 30)), 'month')
  }

  return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60 * 24 * 365)), 'year')
}

function getProjectLeaf(projectPath: string): string {
  const segments = projectPath.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? projectPath
}

function getProjectPath(session: Pick<SessionRef, 'project' | 'cwd' | 'path'>): string {
  if (session.cwd?.trim()) {
    return session.cwd.trim()
  }

  if (session.project?.trim()) {
    return session.project.trim()
  }

  if (session.path?.trim()) {
    return session.path.trim()
  }

  return 'Unknown project'
}

function getProjectSubtitle(projectPath: string, projectTitle: string): string {
  return projectPath === projectTitle || projectPath === 'Unknown project' ? '' : projectPath
}

function getTurnLengthBucket(turnCount: number): BrowserTurnLength {
  if (turnCount >= 30) {
    return 'long'
  }

  if (turnCount >= 10) {
    return 'medium'
  }

  return 'short'
}

function matchesUpdatedWithin(
  updatedAtValue: number,
  updatedWithin: BrowserUpdatedWithin,
  nowMs: number,
): boolean {
  if (updatedWithin === 'all' || updatedAtValue === 0) {
    return true
  }

  const ageMs = Math.max(0, nowMs - updatedAtValue)

  switch (updatedWithin) {
    case 'today': {
      return ageMs <= 24 * 60 * 60 * 1000
    }

    case '7d': {
      return ageMs <= 7 * 24 * 60 * 60 * 1000
    }

    case '30d': {
      return ageMs <= 30 * 24 * 60 * 60 * 1000
    }

    case 'older': {
      return ageMs > 30 * 24 * 60 * 60 * 1000
    }

    default: {
      return true
    }
  }
}

function normalizeProjectKey(projectPath: string): string {
  return projectPath.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function parseTimestamp(timestamp?: string | null): number {
  if (!timestamp) {
    return 0
  }

  const nextValue = Date.parse(timestamp)
  return Number.isNaN(nextValue) ? 0 : nextValue
}

function sortSources(sources: string[]): string[] {
  return [...sources].sort((left, right) => {
    const leftIndex = sourceOrder.indexOf(left)
    const rightIndex = sourceOrder.indexOf(right)

    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex - rightIndex
    }

    if (leftIndex >= 0) {
      return -1
    }

    if (rightIndex >= 0) {
      return 1
    }

    return left.localeCompare(right)
  })
}