import { basename } from 'node:path'
import { basenameWithoutExtension, normalizePathForId } from '../session-files/path-utils'
import type {
  IndexedSessionEntry,
  NormalizedSession,
  SessionRef,
  SessionSearchDoc,
} from '../../src/lib/session/contracts'

export function compareSessionRefs(
  left: Readonly<SessionRef>,
  right: Readonly<SessionRef>,
): number {
  return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
}

export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
}

export function createSearchDocFromSession(
  ref: Readonly<SessionRef>,
  session: Readonly<NormalizedSession>,
): SessionSearchDoc {
  const metadataText = normalizeSearchText(
    [
      ref.id,
      ref.title,
      ref.source,
      ref.path,
      ref.project,
      ref.cwd,
      ref.summary,
      ref.startedAt,
      ref.updatedAt,
      ref.stats?.turnCount,
      ref.stats?.userTurnCount,
      ref.stats?.assistantTurnCount,
      ref.stats?.toolCallCount,
    ]
      .filter(Boolean)
      .join(' '),
  )

  const transcriptText = normalizeSearchText(
    [
      ...session.turns.map((turn) => turn.userText),
      ...session.turns.flatMap((turn) => turn.assistantBlocks.map((block) => block.text)),
      ...session.turns.flatMap((turn) =>
        turn.toolCalls.flatMap((toolCall) => [
          toolCall.name,
          stringifyToolFragment(toolCall.input),
          toolCall.result ?? '',
        ]),
      ),
    ]
      .flat()
      .filter(Boolean)
      .join(' '),
  )

  return {
    metadataText,
    transcriptText,
  }
}

export function indexedSessionMatchesQuery(
  entry: Readonly<IndexedSessionEntry>,
  query: string,
): boolean {
  const needle = normalizeSearchText(query)
  if (!needle) {
    return false
  }

  return (
    entry.searchDoc.metadataText.includes(needle) ||
    entry.searchDoc.transcriptText.includes(needle)
  )
}

export function matchSessionRefForRequest(
  refs: readonly SessionRef[],
  request: Readonly<{ path?: string; sessionId?: string }>,
): SessionRef | null {
  if (request.path) {
    const normalizedPath = normalizePathForId(request.path)
    return (
      refs.find((ref) => normalizePathForId(ref.path) === normalizedPath) ??
      refs.find((ref) => normalizePathForId(ref.id) === normalizedPath) ??
      null
    )
  }

  const sessionId = request.sessionId?.trim()
  if (!sessionId) {
    return null
  }

  const normalizedSessionId = normalizePathForId(sessionId)
  const directMatch = refs.find(
    (ref) =>
      normalizePathForId(ref.id) === normalizedSessionId ||
      normalizePathForId(ref.path) === normalizedSessionId,
  )
  if (directMatch) {
    return directMatch
  }

  const requestedBase = basename(sessionId)
  const requestedWithoutExt = basenameWithoutExtension(sessionId)

  return (
    refs.find((ref) => basename(ref.path) === sessionId) ??
    refs.find((ref) => basenameWithoutExtension(ref.path) === requestedBase) ??
    refs.find((ref) => basenameWithoutExtension(ref.path) === requestedWithoutExt) ??
    null
  )
}

function stringifyToolFragment(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
