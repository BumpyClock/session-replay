import { z } from 'zod'

const nonEmptyString = z.string().min(1)
const nonNegativeInteger = z.number().int().nonnegative()

export const sessionStatsSchema = z.object({
  assistantTurnCount: nonNegativeInteger.optional(),
  toolCallCount: nonNegativeInteger.optional(),
  turnCount: nonNegativeInteger,
  userTurnCount: nonNegativeInteger.optional(),
}).strict()

export const replayTextBlockSchema = z.object({
  id: nonEmptyString,
  language: z.string().optional(),
  text: z.string(),
  title: z.string().optional(),
  type: z.enum(['code', 'json', 'markdown', 'text', 'thinking']),
}).strict()

export const replayToolBlockSchema = z.object({
  id: nonEmptyString,
  input: z.unknown().optional(),
  isError: z.boolean().optional(),
  name: nonEmptyString,
  output: z.string().optional(),
  resultTimestamp: nonEmptyString.optional(),
  status: z.enum(['completed', 'failed', 'running']).optional(),
  timestamp: nonEmptyString.optional(),
  title: z.string().optional(),
  type: z.literal('tool'),
}).strict()

export const replayBlockSchema = z.discriminatedUnion('type', [
  replayTextBlockSchema,
  replayToolBlockSchema,
])

export const replayTurnSchema = z.object({
  blocks: z.array(replayBlockSchema),
  id: nonEmptyString,
  included: z.boolean().optional(),
  index: nonNegativeInteger,
  label: z.string().optional(),
  role: z.enum(['assistant', 'system', 'tool', 'user']),
  timestamp: nonEmptyString.optional(),
}).strict()

export const replayBookmarkSchema = z.object({
  id: nonEmptyString,
  label: z.string(),
  turnIndex: nonNegativeInteger,
}).strict()

export const materializedReplaySessionSchema = z.object({
  bookmarks: z.array(replayBookmarkSchema).optional(),
  cwd: z.string().optional(),
  description: z.string().optional(),
  id: nonEmptyString,
  project: z.string().optional(),
  source: nonEmptyString,
  startedAt: nonEmptyString.optional(),
  stats: sessionStatsSchema.optional(),
  summary: z.string().optional(),
  title: nonEmptyString,
  turns: z.array(replayTurnSchema),
  updatedAt: nonEmptyString.optional(),
}).strict()

export const replayRenderOptionsSchema = z.object({
  autoplayDelayMs: nonNegativeInteger.optional(),
  exportTitle: z.string().optional(),
  includeThinking: z.boolean().optional(),
  includeToolCalls: z.boolean().optional(),
  initialTurnIndex: nonNegativeInteger.optional(),
  keepTimestamps: z.boolean().optional(),
  revealThinking: z.boolean().optional(),
}).strict()

export const sessionLoadRequestSchema = z.object({
  path: nonEmptyString.optional(),
  sessionId: nonEmptyString.optional(),
}).strict().refine((request) => request.path !== undefined || request.sessionId !== undefined)

export const sessionSearchRequestSchema = z.object({
  limit: z.number().int().positive().optional(),
  query: z.string(),
}).strict()

export const sessionRenderRequestSchema = z.object({
  options: replayRenderOptionsSchema.optional(),
  session: materializedReplaySessionSchema,
}).strict()

export type MaterializedReplaySession = z.infer<typeof materializedReplaySessionSchema>
export type ReplayBlock = z.infer<typeof replayBlockSchema>
export type ReplayBookmark = z.infer<typeof replayBookmarkSchema>
export type ReplayRenderOptions = z.infer<typeof replayRenderOptionsSchema>
export type ReplayRole = MaterializedReplaySession['turns'][number]['role']
export type ReplayTextBlock = z.infer<typeof replayTextBlockSchema>
export type ReplayToolBlock = z.infer<typeof replayToolBlockSchema>
export type ReplayTurn = z.infer<typeof replayTurnSchema>
export type SessionLoadRequest = z.infer<typeof sessionLoadRequestSchema>
export type SessionRenderRequest = z.infer<typeof sessionRenderRequestSchema>
export type SessionSearchRequest = z.infer<typeof sessionSearchRequestSchema>
export type SessionStats = z.infer<typeof sessionStatsSchema>
