import type {
  MaterializedReplaySession,
  ReplayToolCall,
  ReplayTurn,
  SessionRef as ApiSessionRef,
  SessionStats,
} from "../api/contracts";
import type { NormalizedSession, SessionToolCall, SessionRef } from "./contracts";

export function summarizeNormalizedSession(session: NormalizedSession): string | undefined {
  const firstUserTurn = session.turns.find((turn) => turn.userText.trim());
  return firstUserTurn ? truncateText(firstUserTurn.userText, 96) : undefined;
}

export function createSessionStats(session: NormalizedSession): SessionStats {
  const replayTurns = buildReplayTurns(session);
  const toolCallCount = session.turns.reduce(
    (count, turn) => count + turn.toolCalls.length,
    0,
  );

  return {
    turnCount: replayTurns.length,
    userTurnCount: replayTurns.filter((turn) => turn.role === "user").length,
    assistantTurnCount: replayTurns.filter((turn) => turn.role === "assistant").length,
    toolCallCount,
  };
}

export function toApiSessionRef(
  ref: SessionRef,
  session?: NormalizedSession,
): ApiSessionRef {
  const summary = session ? summarizeNormalizedSession(session) : ref.title;
  const stats = session ? createSessionStats(session) : undefined;

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

export function sessionMatchesQuery(
  session: NormalizedSession,
  query: string,
): boolean {
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
    ...session.turns.flatMap((turn) => turn.assistantBlocks.map((block) => block.text)),
    ...session.turns.flatMap((turn) =>
      turn.toolCalls.flatMap((toolCall) => [
        toolCall.name,
        stringifyToolFragment(toolCall.input),
        toolCall.result ?? "",
      ]),
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

    if (turn.assistantBlocks.length > 0 || turn.toolCalls.length > 0) {
      replayTurns.push({
        id: `${turn.id}:assistant`,
        index: replayTurns.length,
        role: "assistant",
        timestamp:
          turn.assistantBlocks.find((block) => block.timestamp)?.timestamp ??
          turn.toolCalls.find((toolCall) => toolCall.timestamp)?.timestamp ??
          turn.timestamp ??
          undefined,
        included: true,
        blocks: turn.assistantBlocks.map((block) => ({
          id: block.id,
          type: block.kind === "thinking" ? "thinking" : "markdown",
          text: block.text,
        })),
        toolCalls:
          turn.toolCalls.length > 0
            ? turn.toolCalls.map(toReplayToolCall)
            : undefined,
      });
    }
  }

  return replayTurns;
}

function toReplayToolCall(toolCall: SessionToolCall): ReplayToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.result
      ? toolCall.isError
        ? "failed"
        : "completed"
      : "running",
    input: stringifyToolFragment(toolCall.input),
    output: toolCall.result ?? undefined,
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
