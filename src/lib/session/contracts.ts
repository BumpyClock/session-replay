import type { SessionStats } from "../api/contracts";

export type SessionSource =
  | "claude-code"
  | "codex"
  | "copilot"
  | "cursor"
  | "gemini";

export type SessionTextBlockKind = "text" | "thinking";

/**
 * Raw transcript origin for normalized entities.
 * Used by editor/export layers to trace data back to immutable source files.
 */
export interface SessionSourceMeta {
  provider: SessionSource;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  eventIds?: string[];
  rawTypes?: string[];
}

/**
 * Non-fatal parse/discovery issue.
 * Warnings keep readonly loads deterministic while surfacing incomplete input.
 */
export interface SessionWarning {
  code: string;
  message: string;
  filePath?: string;
  line?: number;
}

/**
 * Assistant-authored text block after normalization.
 * Tool calls stay separate so editor/export can render them independently.
 */
export interface SessionTextBlock {
  id: string;
  kind: SessionTextBlockKind;
  text: string;
  timestamp: string | null;
  sourceMeta: SessionSourceMeta;
}

/**
 * Tool invocation emitted by an agent transcript.
 * Input/result stay readonly snapshots from source logs.
 */
export interface SessionToolCall {
  id: string;
  name: string;
  input: unknown;
  result: string | null;
  isError: boolean;
  timestamp: string | null;
  resultTimestamp: string | null;
  sourceMeta: SessionSourceMeta;
}

/**
 * Lightweight catalog entry returned by discovery.
 * Contains enough metadata to populate session lists before full load.
 */
export interface SessionRef {
  id: string;
  path: string;
  source: SessionSource;
  project: string;
  title: string;
  startedAt: string | null;
  updatedAt: string | null;
  cwd: string | null;
  summary?: string;
  stats?: SessionStats;
}

/**
 * One user -> assistant exchange.
 * `role` fixed to `turn` to make transcript semantics explicit.
 */
export interface NormalizedTurn {
  id: string;
  index: number;
  role: "turn";
  timestamp: string | null;
  userText: string;
  assistantBlocks: SessionTextBlock[];
  toolCalls: SessionToolCall[];
  sourceMeta: SessionSourceMeta;
}

/**
 * Canonical readonly session payload used by editor/export layers.
 */
export interface NormalizedSession {
  ref: SessionRef;
  cwd: string | null;
  warnings: SessionWarning[];
  turns: NormalizedTurn[];
}

export interface SessionProviderDiscoveryOptions {
  homeDir: string;
}

export interface SessionFileFingerprint {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface SessionFileRef {
  source: SessionSource;
  path: string;
  relativePath: string;
  fingerprint: SessionFileFingerprint;
}

export interface SessionSearchDoc {
  metadataText: string;
  transcriptText: string;
}

export interface IndexedSessionEntry {
  file: SessionFileRef;
  ref: SessionRef;
  searchDoc: SessionSearchDoc;
  warnings: SessionWarning[];
}

export interface SessionProviderScanOptions {
  homeDir: string;
}

export interface SessionCatalogProvider {
  readonly source: SessionSource;
  scan(options: SessionProviderScanOptions): Promise<SessionFileRef[]>;
  index(file: Readonly<SessionFileRef>): Promise<IndexedSessionEntry>;
  load(file: Readonly<SessionFileRef>): Promise<NormalizedSession>;
}

/**
 * Readonly provider contract.
 * Implementations may discover files and fully load/normalize one session,
 * but must never mutate transcript files or derived server state.
 */
export interface LegacySessionProvider {
  readonly source: SessionSource;
  discover(options: SessionProviderDiscoveryOptions): Promise<SessionRef[]>;
  load(ref: SessionRef): Promise<NormalizedSession>;
}

export type SessionProvider = SessionCatalogProvider | LegacySessionProvider;
