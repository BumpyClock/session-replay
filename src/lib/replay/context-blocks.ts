import type { ReplayBlock, ReplayTextBlock, ReplayToolBlock } from '../api/contracts'

const SPECIAL_TAG_NAMES = [
  'skill-context',
  'invoked_skills',
  'summary',
  'reminder',
  'current_datetime',
  'system_notification',
  'tools_changed_notice',
  'tagged_files',
  'permissions',
  'collaboration_mode',
  'skills_instructions',
  'plugins_instructions',
  'environment_context',
  'turn_aborted',
  'subagent_notification',
  'model_switch',
  'task-notification',
  'persisted-output',
  'teammate-message',
  'tool_use_error',
  'system-reminder',
  'ide_selection',
  'ide_opened_file',
  'session_meta',
  'turn_context',
  'compacted',
  'context_compacted',
  'claude_attachment',
  'claude_progress',
  'claude_system',
  'queue_operation',
  'permission_mode',
  'file_history_snapshot',
  'agent_name',
  'custom_title',
  'pr_link',
  'plan_mode',
  'plan_mode_exit',
] as const

const SPECIAL_TAG_PATTERN = new RegExp(
  `<(${SPECIAL_TAG_NAMES.join('|')})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`,
  'giu',
)
const CONTROL_PRELUDE_LINES = new Set([
  'Some of the conversation history has been summarized to free up context.',
  'Here is a summary of the prior context:',
])

/**
 * Visual categories for synthetic replay metadata cards produced from
 * control-plane wrappers, runtime records, and instruction bundles.
 */
export type ReplayMetaKind =
  | 'agent-activity'
  | 'attachment-context'
  | 'conversation-summary'
  | 'environment-context'
  | 'invoked-skills'
  | 'plan-context'
  | 'runtime-bootstrap'
  | 'runtime-reminder'
  | 'runtime-state'
  | 'skill-context'
  | 'skill-load'
  | 'tool-result-note'
  | 'workspace-instructions'

export interface ReplayMetaField {
  label: string
  value: string
}

/**
 * Synthetic card/pill block created from replay control-plane wrappers.
 */
export interface ReplayMetaBlock {
  id: string
  type: 'meta'
  kind: ReplayMetaKind
  appearance: 'disclosure' | 'inline'
  label: string
  title: string
  summary?: string
  chips?: string[]
  fields?: ReplayMetaField[]
  body?: string
  bodyFormat?: 'markdown' | 'text'
  raw?: string
}

export type ReplayRenderableTextBlock = ReplayTextBlock | ReplayMetaBlock
export type ReplayRenderableBlock = ReplayRenderableTextBlock | ReplayToolBlock

/**
 * Split control-plane transcript scaffolding out of user/assistant prose so
 * replay renderers can show compact metadata cards instead of raw XML/tag dumps.
 */
export function expandReplayBlocks(blocks: readonly ReplayBlock[]): ReplayRenderableBlock[] {
  return blocks.flatMap<ReplayRenderableBlock>((block) => {
    if (block.type === 'tool' || block.type === 'thinking' || block.type === 'code' || block.type === 'json') {
      return [block]
    }

    return expandReplayTextBlock(block)
  })
}

/**
 * Expand a single replay text block into plain text fragments plus synthetic
 * metadata blocks derived from recognized control/runtime wrappers.
 */
export function expandReplayTextBlock(block: ReplayTextBlock): ReplayRenderableTextBlock[] {
  const taggedBlocks = parseTaggedReplayMetaBlocks(block)
  if (taggedBlocks) {
    return taggedBlocks
  }

  const standaloneMeta = parseStandaloneReplayMetaBlock(block.id, block.text)
  return standaloneMeta ? [standaloneMeta] : [block]
}

export function isReplayMetaBlock(
  block: ReplayBlock | ReplayRenderableBlock,
): block is ReplayMetaBlock {
  return block.type === 'meta'
}

export function summarizeReplayMetaBlock(block: ReplayMetaBlock): string {
  return [block.label, block.title].filter(Boolean).join(' · ')
}

function parseTaggedReplayMetaBlocks(block: ReplayTextBlock): ReplayRenderableTextBlock[] | null {
  const fragments: ReplayRenderableTextBlock[] = []
  let cursor = 0
  let matchIndex = 0

  for (const match of block.text.matchAll(SPECIAL_TAG_PATTERN)) {
    const start = match.index ?? 0
    appendReplayTextFragment(fragments, block, block.text.slice(cursor, start), `text:${matchIndex}`)

    const tagName = String(match[1]).toLowerCase()
    const attrs = String(match[2] ?? '')
    const body = String(match[3] ?? '')
    const raw = String(match[0] ?? '').trim()
    const metaBlock = parseSpecialTagReplayMetaBlock(`${block.id}:meta:${matchIndex}`, tagName, attrs, body, raw)

    if (metaBlock) {
      fragments.push(metaBlock)
    }

    cursor = start + match[0].length
    matchIndex += 1
  }

  if (matchIndex === 0) {
    return null
  }

  appendReplayTextFragment(fragments, block, block.text.slice(cursor), `text:${matchIndex}`)
  return fragments.length > 0 ? fragments : null
}

function appendReplayTextFragment(
  fragments: ReplayRenderableTextBlock[],
  block: ReplayTextBlock,
  value: string,
  suffix: string,
): void {
  const trimmed = value.trim()
  if (!trimmed || CONTROL_PRELUDE_LINES.has(trimmed)) {
    return
  }

  const standaloneMeta = parseStandaloneReplayMetaBlock(`${block.id}:${suffix}`, trimmed)
  if (standaloneMeta) {
    fragments.push(standaloneMeta)
    return
  }

  fragments.push({
    ...block,
    id: `${block.id}:${suffix}`,
    text: trimmed,
  })
}

function parseSpecialTagReplayMetaBlock(
  id: string,
  tagName: string,
  attrs: string,
  body: string,
  raw: string,
): ReplayMetaBlock | null {
  switch (tagName) {
    case 'skill-context':
      return parseSkillContextReplayMetaBlock(id, attrs, body, raw)
    case 'invoked_skills':
      return parseInvokedSkillsReplayMetaBlock(id, body, raw)
    case 'summary':
      return parseConversationSummaryReplayMetaBlock(id, body, raw)
    case 'reminder':
      return parseReminderReplayMetaBlock(id, body, raw)
    case 'current_datetime':
      return null
    case 'system_notification':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'runtime-state',
        label: 'System notification',
        title: normalizeWhitespace(body) || 'Runtime notification',
        chips: ['system'],
      })
    case 'tools_changed_notice':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'runtime-state',
        label: 'Tooling update',
        title: 'Available tools changed',
        chips: extractToolingChips(body),
      })
    case 'tagged_files':
      return parseTaggedFilesReplayMetaBlock(id, body, raw)
    case 'permissions':
      return parsePermissionsReplayMetaBlock(id, body, raw)
    case 'collaboration_mode':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'plan-context',
        label: 'Collaboration mode',
        title: extractFirstMarkdownHeading(body) ?? 'Collaboration mode',
        chips: extractMarkdownHeadings(body).slice(1, 3),
      })
    case 'skills_instructions':
    case 'plugins_instructions':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'runtime-bootstrap',
        label: tagName === 'skills_instructions' ? 'Skill bootstrap' : 'Plugin bootstrap',
        title: tagName === 'skills_instructions' ? 'Injected skill instructions' : 'Injected plugin instructions',
        chips: [
          ...extractMarkdownHeadings(body).slice(0, 2),
          ...extractBulletLikeItems(body).slice(0, 2),
        ],
      })
    case 'environment_context':
      return parseEnvironmentContextReplayMetaBlock(id, body, raw)
    case 'turn_aborted':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'runtime-state',
        label: 'Turn aborted',
        title: 'Turn interrupted',
      })
    case 'subagent_notification':
      return parseSubagentNotificationReplayMetaBlock(id, body, raw)
    case 'model_switch':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'runtime-state',
        label: 'Model switch',
        title: 'Model changed',
      })
    case 'task-notification':
      return parseTaskNotificationReplayMetaBlock(id, body, raw)
    case 'persisted-output':
      return parsePersistedOutputReplayMetaBlock(id, body, raw)
    case 'teammate-message':
      return parseTeammateMessageReplayMetaBlock(id, attrs, body, raw)
    case 'tool_use_error':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'tool-result-note',
        label: 'Tool error',
        title: truncateInlineText(normalizeWhitespace(body), 84) ?? 'Tool execution failed',
      })
    case 'system-reminder':
      return createRuntimeMetaBlock(id, {
        raw,
        body,
        kind: 'runtime-reminder',
        label: 'System reminder',
        title: 'Runtime reminder',
      })
    case 'ide_selection':
      return parseIdeSelectionReplayMetaBlock(id, body, raw)
    case 'ide_opened_file':
      return parseIdeOpenedFileReplayMetaBlock(id, body, raw)
    case 'session_meta':
    case 'turn_context':
    case 'compacted':
    case 'context_compacted':
    case 'claude_attachment':
    case 'claude_progress':
    case 'claude_system':
    case 'queue_operation':
    case 'permission_mode':
    case 'file_history_snapshot':
    case 'agent_name':
    case 'custom_title':
    case 'pr_link':
    case 'plan_mode':
    case 'plan_mode_exit':
      return parseStructuredRuntimeReplayMetaBlock(id, tagName, body, raw)
    default:
      return null
  }
}

function parseStandaloneReplayMetaBlock(id: string, value: string): ReplayMetaBlock | null {
  const permissionsWrapperMatch = value.match(/^<permissions instructions>([\s\S]*?)<\/permissions instructions>\s*$/iu)
  if (permissionsWrapperMatch) {
    return parsePermissionsReplayMetaBlock(id, permissionsWrapperMatch[1], value)
  }

  const skillLoadMatch = value.match(/^Skill\s+"([^"]+)"\s+loaded successfully\.\s*$/iu)
  if (skillLoadMatch) {
    return {
      id,
      type: 'meta',
      kind: 'skill-load',
      appearance: 'inline',
      label: 'Skill loaded',
      title: skillLoadMatch[1].trim(),
      summary: 'Ready',
      raw: value,
    }
  }

  const pastedContentMatch = value.match(/^<pasted_content\b([^>]*)\/>\s*$/iu)
  if (pastedContentMatch) {
    const attrs = readTagAttributes(pastedContentMatch[1] ?? '')
    const filePath = attrs.file
    return {
      id,
      type: 'meta',
      kind: 'attachment-context',
      appearance: 'disclosure',
      label: 'Pasted content',
      title: filePath ? compactPath(filePath) : 'Attached content',
      fields: compactFields([
        { label: 'File', value: filePath },
        { label: 'Size', value: attrs.size },
        { label: 'Lines', value: attrs.lines },
      ]),
      raw: value,
    }
  }

  if (value.startsWith('[[PLAN]]')) {
    return {
      id,
      type: 'meta',
      kind: 'plan-context',
      appearance: 'disclosure',
      label: 'Plan mode',
      title: 'Planning request',
      body: normalizeWhitespace(value.replace(/^\[\[PLAN\]\]\s*/u, '')),
      bodyFormat: 'text',
      raw: value,
    }
  }

  if (value.startsWith('You are now in fleet mode.')) {
    return {
      id,
      type: 'meta',
      kind: 'plan-context',
      appearance: 'disclosure',
      label: 'Fleet mode',
      title: 'Sub-agent orchestration',
      body: extractLeadParagraph(value) ?? normalizeWhitespace(value),
      bodyFormat: 'text',
      raw: value,
    }
  }

  if (/^Generate a session title for this message:/iu.test(value)) {
    return null
  }

  if (/^This session is being continued from a previous conversation/i.test(value)) {
    return {
      id,
      type: 'meta',
      kind: 'conversation-summary',
      appearance: 'disclosure',
      label: 'Conversation summary',
      title: 'Continuation summary',
      body: normalizeWhitespace(value),
      bodyFormat: 'text',
      raw: value,
    }
  }

  const instructions = parseWorkspaceInstructionsReplayMetaBlock(id, value)
  if (instructions) {
    return instructions
  }

  return null
}

function parseSkillContextReplayMetaBlock(
  id: string,
  attrs: string,
  body: string,
  raw: string,
): ReplayMetaBlock {
  const attrName = readTagAttribute(attrs, 'name')
  const frontmatter = readFrontmatter(body)
  const headings = extractMarkdownHeadings(frontmatter.content)
  const relatedFiles = extractRelatedFiles(body)
  const baseDirectory = extractLineValue(body, /^Base directory for this skill:\s*(.+)$/im)
  const title = attrName ?? frontmatter.values.name ?? 'Skill'
  const chips = [
    frontmatter.values.context ? `context ${frontmatter.values.context}` : null,
    relatedFiles.length > 0 ? `${relatedFiles.length} refs` : null,
    headings.length > 0 ? `${headings.length} sections` : null,
  ].filter(Boolean) as string[]
  const fields: ReplayMetaField[] = []

  if (baseDirectory) {
    fields.push({ label: 'Base dir', value: baseDirectory })
  }
  if (relatedFiles.length > 0) {
    fields.push({
      label: 'References',
      value: relatedFiles.map(compactPath).join(', '),
    })
  }
  if (headings.length > 0) {
    fields.push({
      label: 'Sections',
      value: headings.slice(0, 5).join(' · '),
    })
  }

  return {
    id,
    type: 'meta',
    kind: 'skill-context',
    appearance: 'disclosure',
    label: 'Skill context',
    title,
    chips,
    body: frontmatter.values.description ?? undefined,
    bodyFormat: 'text',
    fields: fields.length > 0 ? fields : undefined,
    raw,
  }
}

function parseInvokedSkillsReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const mostRecent = extractLineValue(body, /^##\s+Most recent skill:\s*(.+)$/im)
  const paths = [...body.matchAll(/^Path:\s*(.+)$/gim)].map((match) => match[1].trim())
  const names = unique([
    mostRecent,
    ...[...body.matchAll(/^name:\s*(.+)$/gim)].map((match) => match[1].trim()),
  ].filter(Boolean) as string[])
  const descriptions = [...body.matchAll(/^description:\s*(.+)$/gim)].map((match) => match[1].trim())
  const fields: ReplayMetaField[] = []

  if (mostRecent) {
    fields.push({ label: 'Most recent', value: mostRecent })
  }
  if (names.length > 0) {
    fields.push({ label: 'Skills', value: names.join(', ') })
  }
  if (paths.length > 0) {
    fields.push({ label: 'Paths', value: paths.map(compactPath).join(', ') })
  }

  return {
    id,
    type: 'meta',
    kind: 'invoked-skills',
    appearance: 'disclosure',
    label: 'Invoked skills',
    title: mostRecent ?? (names[0] ?? 'Skill set'),
    chips: [
      names.length > 0 ? `${names.length} loaded` : null,
      paths.length > 0 ? `${paths.length} docs` : null,
    ].filter(Boolean) as string[],
    body: descriptions[0],
    bodyFormat: 'text',
    fields: fields.length > 0 ? fields : undefined,
    raw,
  }
}

function parseConversationSummaryReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const overview = stripXmlTags(extractNestedTag(body, 'overview') ?? '')
  const checkpoint = stripXmlTags(extractNestedTag(body, 'checkpoint_title') ?? '')
  const sections = extractXmlSectionNames(body).filter(
    (name) => !['overview', 'checkpoint_title'].includes(name),
  )
  const fields: ReplayMetaField[] = []

  if (checkpoint) {
    fields.push({ label: 'Checkpoint', value: checkpoint })
  }
  if (sections.length > 0) {
    fields.push({ label: 'Sections', value: sections.join(' · ') })
  }

  return {
    id,
    type: 'meta',
    kind: 'conversation-summary',
    appearance: 'disclosure',
    label: 'Conversation summary',
    title: checkpoint || 'Prior context',
    chips: sections.length > 0 ? [`${sections.length} sections`] : undefined,
    body: overview || undefined,
    bodyFormat: 'text',
    fields: fields.length > 0 ? fields : undefined,
    raw,
  }
}

function parseReminderReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const tags = extractXmlSectionNames(body)
  const flattened = normalizeWhitespace(stripXmlTags(body))

  if (flattened.length <= 72) {
    return {
      id,
      type: 'meta',
      kind: 'runtime-reminder',
      appearance: 'inline',
      label: 'Reminder',
      title: flattened || 'Runtime reminder',
      chips: tags.length > 0 ? tags : undefined,
      raw,
    }
  }

  return {
    id,
    type: 'meta',
    kind: 'runtime-reminder',
    appearance: 'disclosure',
    label: 'Reminder',
    title: 'Runtime reminder',
    chips: tags.length > 0 ? tags : undefined,
    body: flattened || undefined,
    bodyFormat: 'text',
    raw,
  }
}

function parseWorkspaceInstructionsReplayMetaBlock(
  id: string,
  value: string,
): ReplayMetaBlock | null {
  const headings = extractMarkdownHeadings(value)
  const looksLikeAgentGuide =
    /AGENTS\.md|CLAUDE\.md/iu.test(value)
    || headings.some((heading) =>
      ['Agent Protocols', 'Communication style', 'Priorities', 'Tone and style'].includes(heading),
    )

  if (!looksLikeAgentGuide || headings.length < 2) {
    return null
  }

  const sourceFile = value.match(/\b(AGENTS\.md|CLAUDE\.md)\b/iu)?.[1]
  const lead = extractLeadParagraph(value)

  return {
    id,
    type: 'meta',
    kind: 'workspace-instructions',
    appearance: 'disclosure',
    label: 'Workspace instructions',
    title: sourceFile ?? 'Instruction bundle',
    chips: [sourceFile, `${headings.length} sections`].filter(Boolean) as string[],
    body: lead || undefined,
    bodyFormat: 'text',
    fields: [
      {
        label: 'Sections',
        value: headings.slice(0, 6).join(' · '),
      },
    ],
    raw: value,
  }
}

function parsePermissionsReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  return {
    id,
    type: 'meta',
    kind: 'runtime-bootstrap',
    appearance: 'disclosure',
    label: 'Runtime permissions',
    title: buildPermissionsTitle(body),
    chips: compactChips([
      readKeyValue(body, 'sandbox_mode'),
      readKeyValue(body, 'approval_policy'),
      /network access is enabled/iu.test(body) ? 'network enabled' : null,
    ]),
    body: normalizeWhitespace(body),
    bodyFormat: 'text',
    raw,
  }
}

function parseEnvironmentContextReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const fields = compactFields([
    { label: 'cwd', value: stripXmlTags(extractNestedTag(body, 'cwd') ?? '') },
    { label: 'shell', value: stripXmlTags(extractNestedTag(body, 'shell') ?? '') },
    { label: 'date', value: stripXmlTags(extractNestedTag(body, 'current_date') ?? '') },
    { label: 'approval', value: stripXmlTags(extractNestedTag(body, 'approval_policy') ?? '') },
    { label: 'sandbox', value: stripXmlTags(extractNestedTag(body, 'sandbox_mode') ?? '') },
  ]) ?? []

  return {
    id,
    type: 'meta',
    kind: 'environment-context',
    appearance: 'disclosure',
    label: 'Environment',
    title: fields.find((field) => field.label === 'cwd')?.value ?? 'Runtime context',
    chips: fields
      .filter((field) => field.label !== 'cwd')
      .slice(0, 3)
      .map((field) => `${field.label} ${field.value}`),
    fields,
    raw,
  }
}

function parseSubagentNotificationReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const parsedPayload = parseJsonValue(body)
  const payload = asRecord(parsedPayload)
  const agentPath = readNestedString(payload, ['agent_path'])
  const agentId = readNestedString(payload, ['agent_id'])
  const status = readNestedRecord(payload, ['status'])
  const statusLabel = status ? Object.keys(status)[0] : null
  const statusValue = status && statusLabel ? readRecordPreview(status[statusLabel]) : null

  return {
    id,
    type: 'meta',
    kind: 'agent-activity',
    appearance: 'disclosure',
    label: 'Sub-agent',
    title: compactPath(agentPath ?? agentId ?? 'Sub-agent update'),
    summary: statusLabel ?? undefined,
    chips: compactChips([statusLabel, statusValue]),
    fields: compactFields([
      { label: 'Agent', value: agentPath ?? agentId },
      { label: 'Status', value: statusLabel },
      { label: 'Details', value: statusValue },
    ]),
    body: typeof parsedPayload === 'string' ? parsedPayload : undefined,
    bodyFormat: 'text',
    raw,
  }
}

function parseTaskNotificationReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const summary = stripXmlTags(extractNestedTag(body, 'summary') ?? '')
  const status = stripXmlTags(extractNestedTag(body, 'status') ?? '')
  const outputFile = stripXmlTags(extractNestedTag(body, 'output-file') ?? '')
  const taskId = stripXmlTags(extractNestedTag(body, 'task-id') ?? '')
  const toolUseId = stripXmlTags(extractNestedTag(body, 'tool-use-id') ?? '')

  return {
    id,
    type: 'meta',
    kind: 'agent-activity',
    appearance: 'disclosure',
    label: 'Background task',
    title: summary || 'Background task update',
    chips: compactChips([status, outputFile ? 'saved output' : null]),
    fields: compactFields([
      { label: 'Status', value: status },
      { label: 'Task', value: taskId },
      { label: 'Tool', value: toolUseId },
      { label: 'Output', value: outputFile },
    ]),
    raw,
  }
}

function parsePersistedOutputReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const outputFile = extractLineValue(body, /saved to:\s*(.+?)(?:\s+Preview|\s*$)/iu)
  const preview = extractLineValue(body, /Preview(?:\s*\(.*?\))?:\s*(.+)$/iu)

  return {
    id,
    type: 'meta',
    kind: 'tool-result-note',
    appearance: 'disclosure',
    label: 'Tool result',
    title: 'Large output persisted',
    chips: compactChips([outputFile ? 'saved to file' : null]),
    fields: compactFields([{ label: 'Output file', value: outputFile }]),
    body: preview ? normalizeWhitespace(preview) : normalizeWhitespace(body),
    bodyFormat: 'text',
    raw,
  }
}

function parseTeammateMessageReplayMetaBlock(
  id: string,
  attrs: string,
  body: string,
  raw: string,
): ReplayMetaBlock {
  const teammateId = readTagAttribute(attrs, 'teammate_id')
  const color = readTagAttribute(attrs, 'color')
  const summary = readTagAttribute(attrs, 'summary')

  return {
    id,
    type: 'meta',
    kind: 'agent-activity',
    appearance: 'disclosure',
    label: 'Teammate update',
    title: summary ?? compactPath(teammateId ?? 'Teammate'),
    chips: compactChips([teammateId, color]),
    fields: compactFields([
      { label: 'Teammate', value: teammateId },
      { label: 'Color', value: color },
    ]),
    body: body.trim() || undefined,
    bodyFormat: 'markdown',
    raw,
  }
}

function parseIdeSelectionReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const file = extractLineValue(body, /^File:\s*(.+)$/im)
  const selection = body.match(/```[\w-]*\n([\s\S]*?)```/u)?.[1]?.trim()

  return {
    id,
    type: 'meta',
    kind: 'environment-context',
    appearance: 'disclosure',
    label: 'IDE selection',
    title: file ? compactPath(file) : 'Editor selection',
    fields: compactFields([{ label: 'File', value: file }]),
    body: selection ?? normalizeWhitespace(stripXmlTags(body)),
    bodyFormat: selection ? 'markdown' : 'text',
    raw,
  }
}

function parseIdeOpenedFileReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const normalized = normalizeWhitespace(stripXmlTags(body))
  return {
    id,
    type: 'meta',
    kind: 'environment-context',
    appearance: 'inline',
    label: 'IDE file',
    title: truncateInlineText(normalized, 84) ?? 'Opened file',
    raw,
  }
}

function parseTaggedFilesReplayMetaBlock(id: string, body: string, raw: string): ReplayMetaBlock {
  const files = body
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*[*-]\s+/u, '').trim())
    .filter(Boolean)

  return {
    id,
    type: 'meta',
    kind: 'attachment-context',
    appearance: 'disclosure',
    label: 'Tagged files',
    title: files[0] ? compactPath(files[0]) : 'Attached files',
    chips: compactChips([files.length > 0 ? `${files.length} files` : null]),
    fields: files.length > 0
      ? [{ label: 'Files', value: files.map(compactPath).join(', ') }]
      : undefined,
    raw,
  }
}

function parseStructuredRuntimeReplayMetaBlock(
  id: string,
  tagName: string,
  body: string,
  raw: string,
): ReplayMetaBlock {
  const payload = parseJsonValue(body)
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null

  switch (tagName) {
    case 'session_meta':
      return {
        id,
        type: 'meta',
        kind: 'runtime-state',
        appearance: 'disclosure',
        label: 'Session runtime',
        title: 'Session metadata',
        chips: compactChips([
          readNestedString(record, ['payload', 'cli_version']),
          readNestedString(record, ['payload', 'provider']),
        ]),
        fields: compactFields([
          { label: 'cwd', value: readNestedString(record, ['payload', 'cwd']) },
          { label: 'branch', value: readNestedString(record, ['payload', 'git', 'branch']) },
          { label: 'commit', value: readNestedString(record, ['payload', 'git', 'commit_hash']) },
        ]),
        raw,
      }
    case 'turn_context':
      return {
        id,
        type: 'meta',
        kind: 'runtime-state',
        appearance: 'disclosure',
        label: 'Turn runtime',
        title: 'Turn context',
        chips: compactChips([
          readNestedString(record, ['payload', 'approval_policy']),
          readNestedString(record, ['payload', 'effort']),
          readNestedString(record, ['payload', 'model']),
        ]),
        fields: compactFields([
          { label: 'Model', value: readNestedString(record, ['payload', 'model']) },
          { label: 'Effort', value: readNestedString(record, ['payload', 'effort']) },
          { label: 'Approval', value: readNestedString(record, ['payload', 'approval_policy']) },
          { label: 'Sandbox', value: readNestedString(record, ['payload', 'sandbox_policy', 'type']) },
        ]),
        raw,
      }
    case 'compacted':
    case 'context_compacted':
      return {
        id,
        type: 'meta',
        kind: 'conversation-summary',
        appearance: 'disclosure',
        label: 'Conversation summary',
        title: 'History compacted',
        chips: compactChips([
          Array.isArray(record?.payload) ? `${record.payload.length} items` : null,
          Array.isArray(readNestedArray(record, ['payload', 'replacement_history']))
            ? `${readNestedArray(record, ['payload', 'replacement_history'])!.length} replacements`
            : null,
        ]),
        raw,
      }
    case 'claude_attachment':
      return parseClaudeAttachmentReplayMetaBlock(id, record, raw)
    case 'claude_progress':
      return parseClaudeProgressReplayMetaBlock(id, record, raw)
    case 'claude_system':
      return parseClaudeSystemReplayMetaBlock(id, record, raw)
    case 'queue_operation':
      return {
        id,
        type: 'meta',
        kind: 'agent-activity',
        appearance: 'disclosure',
        label: 'Background task',
        title: readNestedString(record, ['operation']) ?? 'Queue operation',
        chips: compactChips([readNestedString(record, ['operation'])]),
        body: readNestedString(record, ['content']) ?? undefined,
        bodyFormat: 'text',
        raw,
      }
    case 'permission_mode':
    case 'file_history_snapshot':
    case 'agent_name':
    case 'custom_title':
    case 'pr_link':
    case 'plan_mode':
    case 'plan_mode_exit':
      return {
        id,
        type: 'meta',
        kind: tagName.startsWith('plan_mode') ? 'plan-context' : 'runtime-state',
        appearance: 'disclosure',
        label: formatTagLabel(tagName),
        title: formatStructuredRuntimeTitle(tagName, record),
        body: normalizeWhitespace(body),
        bodyFormat: 'text',
        raw,
      }
    default:
      return {
        id,
        type: 'meta',
        kind: 'runtime-state',
        appearance: 'disclosure',
        label: formatTagLabel(tagName),
        title: formatTagLabel(tagName),
        body: normalizeWhitespace(body),
        bodyFormat: 'text',
        raw,
      }
  }
}

function parseClaudeAttachmentReplayMetaBlock(
  id: string,
  record: Record<string, unknown> | null,
  raw: string,
): ReplayMetaBlock {
  const attachmentType = readNestedString(record, ['attachment', 'type'])
  const hookName = readNestedString(record, ['attachment', 'hookName'])
  const planFilePath = readNestedString(record, ['attachment', 'planFilePath'])

  return {
    id,
    type: 'meta',
    kind: attachmentType?.includes('plan_mode') ? 'plan-context' : 'runtime-state',
    appearance: 'disclosure',
    label: 'Claude attachment',
    title: attachmentType ? formatTagLabel(attachmentType) : 'Runtime attachment',
    chips: compactChips([hookName, readNestedString(record, ['attachment', 'style'])]),
    fields: compactFields([
      { label: 'Hook', value: hookName },
      { label: 'Plan file', value: planFilePath },
      { label: 'Permissions', value: readNestedString(record, ['attachment', 'permissionMode']) },
    ]),
    raw,
  }
}

function parseClaudeProgressReplayMetaBlock(
  id: string,
  record: Record<string, unknown> | null,
  raw: string,
): ReplayMetaBlock {
  return {
    id,
    type: 'meta',
    kind: 'runtime-state',
    appearance: 'disclosure',
    label: 'Claude progress',
    title: readNestedString(record, ['data', 'type']) ?? 'Progress update',
    chips: compactChips([
      readNestedString(record, ['data', 'query']),
      readNestedString(record, ['data', 'hookName']),
    ]),
    raw,
  }
}

function parseClaudeSystemReplayMetaBlock(
  id: string,
  record: Record<string, unknown> | null,
  raw: string,
): ReplayMetaBlock {
  return {
    id,
    type: 'meta',
    kind: 'runtime-state',
    appearance: 'disclosure',
    label: 'Claude system',
    title: readNestedString(record, ['subtype']) ?? 'System event',
    body: readNestedString(record, ['content']) ?? undefined,
    bodyFormat: 'text',
    raw,
  }
}

function createRuntimeMetaBlock(
  id: string,
  input: {
    body: string
    chips?: string[]
    kind: ReplayMetaKind
    label: string
    raw: string
    title: string
  },
): ReplayMetaBlock {
  return {
    id,
    type: 'meta',
    kind: input.kind,
    appearance: 'disclosure',
    label: input.label,
    title: input.title,
    chips: input.chips,
    body: normalizeWhitespace(stripXmlTags(input.body)) || undefined,
    bodyFormat: 'text',
    raw: input.raw,
  }
}

function readTagAttributes(attrs: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const match of attrs.matchAll(/([a-z0-9_-]+)="([^"]*)"/giu)) {
    values[match[1].toLowerCase()] = match[2].trim()
  }

  return values
}

function readTagAttribute(attrs: string, name: string): string | null {
  return readTagAttributes(attrs)[name] ?? null
}

function readFrontmatter(value: string): {
  content: string
  values: Record<string, string>
} {
  const match = value.match(/^\s*---\s*\n([\s\S]*?)\n---\s*\n?/u)
  if (!match) {
    return { content: value.trim(), values: {} }
  }

  const values: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/u)) {
    const frontmatterMatch = line.match(/^([a-z0-9_-]+):\s*(.+)$/iu)
    if (!frontmatterMatch) {
      continue
    }

    values[frontmatterMatch[1]] = frontmatterMatch[2].trim()
  }

  return {
    content: value.slice(match[0].length).trim(),
    values,
  }
}

function extractMarkdownHeadings(value: string): string[] {
  return unique(
    [...value.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) => normalizeWhitespace(match[1])),
  )
}

function extractFirstMarkdownHeading(value: string): string | null {
  return extractMarkdownHeadings(value)[0] ?? null
}

function extractBulletLikeItems(value: string): string[] {
  return unique(
    [...value.matchAll(/^\s*[-*]\s+(.+)$/gmu)].map((match) => normalizeWhitespace(match[1])),
  )
}

function extractRelatedFiles(value: string): string[] {
  const lines = value.split(/\r?\n/u)
  const files: string[] = []
  let collecting = false

  for (const line of lines) {
    if (!collecting && /Related files/i.test(line)) {
      collecting = true
      continue
    }

    if (!collecting) {
      continue
    }

    const fileMatch = line.match(/^\s*-\s+(.+)$/u)
    if (fileMatch) {
      files.push(fileMatch[1].trim())
      continue
    }

    if (line.trim()) {
      break
    }
  }

  return files
}

function extractNestedTag(value: string, tagName: string): string | null {
  const match = value.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'iu'))
  return match?.[1]?.trim() ?? null
}

function extractXmlSectionNames(value: string): string[] {
  return unique(
    [...value.matchAll(/<([a-z][a-z0-9_-]*)\b/giu)]
      .map((match) => match[1].replaceAll('_', ' '))
      .filter((name) => !name.includes('-context')),
  )
}

function extractLineValue(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern)
  return match?.[1]?.trim() ?? null
}

function extractLeadParagraph(value: string): string | null {
  const paragraphs = value
    .split(/\n\s*\n/u)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)

  const lead = paragraphs.find((part) => !part.startsWith('#') && !part.startsWith('- '))
  return lead ?? null
}

function extractToolingChips(value: string): string[] {
  const normalized = normalizeWhitespace(value)
  if (!normalized) {
    return []
  }

  const additions = extractLineValue(value, /New tools available:\s*(.+?)(?:Tools no longer available:|$)/iu)
  const removals = extractLineValue(value, /Tools no longer available:\s*(.+)$/iu)
  return compactChips([
    additions ? `new ${truncateInlineText(additions, 36)}` : null,
    removals ? `removed ${truncateInlineText(removals, 36)}` : null,
  ]) ?? []
}

function stripXmlTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, ' '))
}

function compactPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').split('/').filter(Boolean)
  return normalized.slice(-2).join('/') || value
}

function formatTagLabel(value: string): string {
  return value.replaceAll(/[_-]+/g, ' ').trim()
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function compactFields(
  fields: Array<{ label: string; value: string | null | undefined }>,
): ReplayMetaField[] | undefined {
  const compacted = fields
    .filter((field) => field.value && String(field.value).trim())
    .map((field) => ({ label: field.label, value: String(field.value).trim() }))
  return compacted.length > 0 ? compacted : undefined
}

function compactChips(values: Array<string | null | undefined>): string[] | undefined {
  const compacted = values
    .map((value) => value?.trim())
    .filter(Boolean) as string[]
  return compacted.length > 0 ? unique(compacted) : undefined
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readNestedString(
  value: Record<string, unknown> | null | undefined,
  path: readonly string[],
): string | null {
  let current: unknown = value

  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null
    }

    current = (current as Record<string, unknown>)[key]
  }

  return typeof current === 'string' && current.trim() ? current.trim() : null
}

function readNestedRecord(
  value: Record<string, unknown> | null | undefined,
  path: readonly string[],
): Record<string, unknown> | null {
  let current: unknown = value

  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null
    }

    current = (current as Record<string, unknown>)[key]
  }

  return current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : null
}

function readNestedArray(
  value: Record<string, unknown> | null | undefined,
  path: readonly string[],
): unknown[] | null {
  let current: unknown = value

  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null
    }

    current = (current as Record<string, unknown>)[key]
  }

  return Array.isArray(current) ? current : null
}

function readRecordPreview(value: unknown): string | null {
  if (typeof value === 'string') {
    return truncateInlineText(normalizeWhitespace(value), 60)
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  const parts = Object.entries(value as Record<string, unknown>)
    .slice(0, 2)
    .map(([key, entryValue]) => `${key} ${typeof entryValue === 'string' ? entryValue : String(entryValue)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function formatStructuredRuntimeTitle(
  tagName: string,
  record: Record<string, unknown> | null,
): string {
  switch (tagName) {
    case 'permission_mode':
      return readNestedString(record, ['permissionMode']) ?? 'Permission mode'
    case 'agent_name':
      return readNestedString(record, ['name']) ?? 'Agent name'
    case 'custom_title':
      return readNestedString(record, ['title']) ?? 'Custom title'
    case 'pr_link':
      return readNestedString(record, ['url']) ?? 'Pull request link'
    case 'plan_mode':
    case 'plan_mode_exit':
      return tagName === 'plan_mode' ? 'Plan mode entered' : 'Plan mode exited'
    default:
      return formatTagLabel(tagName)
  }
}

function buildPermissionsTitle(value: string): string {
  const sandbox = readKeyValue(value, 'sandbox_mode')
  const approval = readKeyValue(value, 'approval_policy')
  return [sandbox, approval].filter(Boolean).join(' · ') || 'Runtime permissions'
}

function readKeyValue(value: string, key: string): string | null {
  const match = value.match(new RegExp(`${key}\\s*(?:is|=)\\s*([^\\n.]+)`, 'iu'))
  return match?.[1]?.trim() ?? null
}

function truncateInlineText(value: string, maxLength: number): string | null {
  const normalized = normalizeWhitespace(value)
  if (!normalized) {
    return null
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`
}
