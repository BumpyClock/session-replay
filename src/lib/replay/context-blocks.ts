import type { ReplayBlock, ReplayTextBlock, ReplayToolBlock } from '../api/contracts'

const SPECIAL_TAG_PATTERN = /<(skill-context|invoked_skills|summary|reminder)\b([^>]*)>([\s\S]*?)<\/\1>/giu
const CONTROL_PRELUDE_LINES = new Set([
  'Some of the conversation history has been summarized to free up context.',
  'Here is a summary of the prior context:',
])

export type ReplayMetaKind =
  | 'conversation-summary'
  | 'invoked-skills'
  | 'runtime-reminder'
  | 'skill-context'
  | 'skill-load'
  | 'workspace-instructions'

export interface ReplayMetaField {
  label: string
  value: string
}

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
}

export type ReplayRenderableTextBlock = ReplayTextBlock | ReplayMetaBlock
export type ReplayRenderableBlock = ReplayRenderableTextBlock | ReplayToolBlock

/**
 * Split control-plane transcript scaffolding out of user/assistant prose so
 * replay renderers can show compact metadata cards instead of raw XML/tag dumps.
 */
export function expandReplayBlocks(blocks: readonly ReplayBlock[]): ReplayRenderableBlock[] {
  return blocks.flatMap((block) => {
    if (block.type === 'tool' || block.type === 'thinking' || block.type === 'code' || block.type === 'json') {
      return [block]
    }

    return expandReplayTextBlock(block)
  })
}

export function isReplayMetaBlock(
  block: ReplayBlock | ReplayRenderableBlock,
): block is ReplayMetaBlock {
  return block.type === 'meta'
}

export function summarizeReplayMetaBlock(block: ReplayMetaBlock): string {
  return [block.label, block.title].filter(Boolean).join(' · ')
}

function expandReplayTextBlock(block: ReplayTextBlock): ReplayRenderableBlock[] {
  const taggedBlocks = parseTaggedReplayMetaBlocks(block)
  if (taggedBlocks) {
    return taggedBlocks
  }

  const standaloneMeta = parseStandaloneReplayMetaBlock(block.id, block.text)
  return standaloneMeta ? [standaloneMeta] : [block]
}

function parseTaggedReplayMetaBlocks(block: ReplayTextBlock): ReplayRenderableBlock[] | null {
  const fragments: ReplayRenderableBlock[] = []
  let cursor = 0
  let matchIndex = 0

  for (const match of block.text.matchAll(SPECIAL_TAG_PATTERN)) {
    const start = match.index ?? 0
    appendReplayTextFragment(fragments, block, block.text.slice(cursor, start), `text:${matchIndex}`)

    const tagName = String(match[1]).toLowerCase()
    const attrs = String(match[2] ?? '')
    const body = String(match[3] ?? '')
    const metaBlock = parseSpecialTagReplayMetaBlock(`${block.id}:meta:${matchIndex}`, tagName, attrs, body)

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
  fragments: ReplayRenderableBlock[],
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
): ReplayMetaBlock | null {
  switch (tagName) {
    case 'skill-context':
      return parseSkillContextReplayMetaBlock(id, attrs, body)
    case 'invoked_skills':
      return parseInvokedSkillsReplayMetaBlock(id, body)
    case 'summary':
      return parseConversationSummaryReplayMetaBlock(id, body)
    case 'reminder':
      return parseReminderReplayMetaBlock(id, body)
    default:
      return null
  }
}

function parseStandaloneReplayMetaBlock(id: string, value: string): ReplayMetaBlock | null {
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
  }
}

function parseInvokedSkillsReplayMetaBlock(id: string, body: string): ReplayMetaBlock {
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
  }
}

function parseConversationSummaryReplayMetaBlock(id: string, body: string): ReplayMetaBlock {
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
  }
}

function parseReminderReplayMetaBlock(id: string, body: string): ReplayMetaBlock {
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
  }
}

function readTagAttribute(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}="([^"]+)"`, 'iu'))
  return match?.[1]?.trim() ?? null
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

function stripXmlTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, ' '))
}

function compactPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').split('/').filter(Boolean)
  return normalized.slice(-2).join('/') || value
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
