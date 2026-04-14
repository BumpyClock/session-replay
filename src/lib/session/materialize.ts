import type {
  MaterializedReplaySession,
  ReplayBlock,
  ReplayTurn,
  SessionRef as ApiSessionRef,
  SessionStats,
} from "../api/contracts";
import type {
  NormalizedSession,
  SessionAssistantBlock,
  SessionRef,
} from "./contracts";

/** Use the first user-authored turn as the list/header summary when available. */
export function summarizeNormalizedSession(session: NormalizedSession): string | undefined {
  const firstUserTurn = session.turns.find((turn) => turn.userText.trim());
  return firstUserTurn ? truncateText(firstUserTurn.userText, 96) : undefined;
}

/**
 * Derive list/header counts from replay-ready turns instead of raw provider rows.
 */
export function createSessionStats(session: NormalizedSession): SessionStats {
  const replayTurns = buildReplayTurns(session);
  const toolCallCount = session.turns.reduce(
    (count, turn) =>
      count +
      [...turn.systemBlocks, ...turn.assistantBlocks].filter((block) => block.kind === "tool-call").length,
    0,
  );

  return {
    turnCount: replayTurns.length,
    userTurnCount: replayTurns.filter((turn) => turn.role === "user").length,
    assistantTurnCount: replayTurns.filter((turn) => turn.role === "assistant").length,
    toolCallCount,
  };
}

/** Materialize one catalog/session row with derived summary + stats. */
export function toApiSessionRef(
  ref: SessionRef,
  session?: NormalizedSession,
): ApiSessionRef {
  const summary = session ? summarizeNormalizedSession(session) : ref.summary ?? ref.title;
  const stats = session ? createSessionStats(session) : ref.stats;

  return {
    id: ref.id,
    title: ref.title,
    source: ref.source,
    path: ref.path,
    project: ref.project,
    cwd: ref.cwd ?? undefined,
    startedAt: ref.startedAt ?? undefined,
    updatedAt: ref.updatedAt ?? undefined,
    summary,
    stats,
  };
}

/** Expand normalized session turns into replay-ready user/system/assistant turns. */
export function toMaterializedReplaySession(
  session: NormalizedSession,
): MaterializedReplaySession {
  const summary = summarizeNormalizedSession(session);

  return {
    id: session.ref.id,
    title: session.ref.title,
    source: session.ref.source,
    project: session.ref.project,
    cwd: session.cwd ?? session.ref.cwd ?? undefined,
    summary,
    startedAt: session.ref.startedAt ?? undefined,
    updatedAt: session.ref.updatedAt ?? undefined,
    stats: createSessionStats(session),
    turns: buildReplayTurns(session),
  };
}

/** Search across metadata, user text, system blocks, assistant text, and tools. */
export function sessionMatchesQuery(
  session: NormalizedSession,
  query: string,
): boolean {
  // Case-insensitive search spans metadata, user text, assistant text,
  // tool names, tool input, and tool output.
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return false;
  }

  const haystack = [
    session.ref.title,
    session.ref.project,
    session.ref.cwd,
    session.ref.path,
    summarizeNormalizedSession(session),
    ...session.turns.map((turn) => turn.userText),
    ...session.turns.flatMap((turn) =>
      [...turn.systemBlocks, ...turn.assistantBlocks].flatMap((block) =>
        block.kind === "tool-call"
          ? [block.name, stringifyToolFragment(block.input), block.result ?? ""]
          : [block.text],
      ),
    ),
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();

  return haystack.includes(needle);
}

function buildReplayTurns(session: NormalizedSession): ReplayTurn[] {
  const replayTurns: ReplayTurn[] = [];

  for (const turn of session.turns) {
    if (turn.systemBlocks.length > 0) {
      replayTurns.push({
        id: `${turn.id}:system`,
        index: replayTurns.length,
        role: "system",
        timestamp:
          turn.systemBlocks.find((block) => block.timestamp)?.timestamp ??
          turn.timestamp ??
          undefined,
        included: true,
        blocks: turn.systemBlocks.map(toReplayBlock),
      });
    }

    if (turn.userText.trim()) {
      replayTurns.push({
        id: `${turn.id}:user`,
        index: replayTurns.length,
        role: "user",
        timestamp: turn.timestamp ?? undefined,
        included: true,
        blocks: [
          {
            id: `${turn.id}:user:text`,
            type: "text",
            text: turn.userText,
          },
        ],
      });
    }

    if (turn.assistantBlocks.length > 0) {
      replayTurns.push({
        id: `${turn.id}:assistant`,
        index: replayTurns.length,
        role: "assistant",
        timestamp:
          turn.assistantBlocks.find((block) => block.timestamp)?.timestamp ??
          turn.timestamp ??
          undefined,
        included: true,
        blocks: turn.assistantBlocks.map(toReplayBlock),
      });
    }
  }

  return replayTurns;
}

function toReplayBlock(block: SessionAssistantBlock): ReplayBlock {
  if (block.kind === "tool-call") {
    return {
      id: block.id,
      type: "tool",
      name: block.name,
      status: block.result
        ? block.isError
          ? "failed"
          : "completed"
        : "running",
      input: block.input,
      output: block.result ?? undefined,
      isError: block.isError,
      resultTimestamp: block.resultTimestamp ?? undefined,
      timestamp: block.timestamp ?? undefined,
    };
  }

  return {
    id: block.id,
    type: block.kind === "thinking" ? "thinking" : "markdown",
    text: block.text,
  };
}

function stringifyToolFragment(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}
