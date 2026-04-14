import type { SessionStats } from "../api/contracts";
import type { NormalizedTurn } from "./contracts.js";

const DEFAULT_TITLE = "Untitled session";
const MAX_SUMMARY_LENGTH = 180;
const MAX_TITLE_LENGTH = 72;

export function buildSessionTitle(
  turns: readonly NormalizedTurn[],
  fallbackTitle = DEFAULT_TITLE,
): string {
  const firstUserText = turns
    .map((turn) => turn.userText.trim())
    .find((text) => text.length > 0);

  if (!firstUserText) {
    return fallbackTitle;
  }

  return collapseText(firstUserText, MAX_TITLE_LENGTH) || fallbackTitle;
}

export function buildSessionSummary(
  turns: readonly NormalizedTurn[],
): string | undefined {
  const firstAssistantText = turns
    .flatMap((turn) => turn.assistantBlocks)
    .flatMap((block) => (block.kind === "tool-call" ? [] : [block.text.trim()]))
    .find((text) => text.length > 0);

  if (!firstAssistantText) {
    return undefined;
  }

  return collapseText(firstAssistantText, MAX_SUMMARY_LENGTH) || undefined;
}

export function buildSessionStats(
  turns: readonly NormalizedTurn[],
): SessionStats {
  const assistantTurnCount = turns.filter(
    (turn) => turn.assistantBlocks.length > 0,
  ).length;
  const toolCallCount = turns.reduce(
    (count, turn) =>
      count + turn.assistantBlocks.filter((block) => block.kind === "tool-call").length,
    0,
  );

  return {
    turnCount: turns.length,
    userTurnCount: turns.filter((turn) => turn.userText.trim().length > 0).length,
    assistantTurnCount,
    toolCallCount,
  };
}

function collapseText(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}
