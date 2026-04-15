import { describe, expect, it } from 'vitest'
import type { ReplayMetaBlock, ReplayRenderableBlock } from '../../src/lib/replay/context-blocks'
import { classifyBlock, stripInlineMarkdown } from '../../src/lib/text-layout/block-estimator'
import {
  FONT_BODY,
  FONT_CODE,
  FONT_DISCLOSURE,
  LINE_HEIGHT_BODY_PX,
  LINE_HEIGHT_CODE_PX,
  LINE_HEIGHT_DISCLOSURE_PX,
} from '../../src/lib/text-layout/typography'

describe('block estimator', () => {
  describe('classifyBlock', () => {
    it('classifies plain text blocks as pretext-eligible with pre-wrap', () => {
      const block: ReplayRenderableBlock = {
        id: 'text-1',
        type: 'text',
        text: 'Hello world\nSecond line',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('text')
      expect(meta.pretextEligible).toBe(true)
      expect(meta.whiteSpaceMode).toBe('pre-wrap')
      expect(meta.measurableText).toBe('Hello world\nSecond line')
      expect(meta.fontShorthand).toBe(FONT_BODY)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_BODY_PX)
      expect(meta.fallbackLineCount).toBeNull()
    })

    it('classifies thinking blocks as pretext-eligible with pre-wrap and disclosure font', () => {
      const block: ReplayRenderableBlock = {
        id: 'think-1',
        type: 'thinking',
        text: 'Let me think about this...\nStep 1: analyze',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('thinking')
      expect(meta.pretextEligible).toBe(true)
      expect(meta.whiteSpaceMode).toBe('pre-wrap')
      expect(meta.measurableText).toBe('Let me think about this...\nStep 1: analyze')
      expect(meta.fontShorthand).toBe(FONT_DISCLOSURE)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_DISCLOSURE_PX)
      expect(meta.fallbackLineCount).toBeNull()
    })

    it('classifies inline-only markdown as pretext-eligible with normal whitespace', () => {
      const block: ReplayRenderableBlock = {
        id: 'md-1',
        type: 'markdown',
        text: 'Some **bold** and *italic* text with a [link](https://example.com).',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('markdown-simple')
      expect(meta.pretextEligible).toBe(true)
      expect(meta.whiteSpaceMode).toBe('normal')
      expect(meta.measurableText).not.toContain('**')
      expect(meta.measurableText).toContain('bold')
      expect(meta.measurableText).toContain('link')
      expect(meta.fontShorthand).toBe(FONT_BODY)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_BODY_PX)
      expect(meta.fallbackLineCount).toBeNull()
    })

    it('classifies structured markdown as complex fallback', () => {
      const block: ReplayRenderableBlock = {
        id: 'md-structured',
        type: 'markdown',
        text: '## Heading\n\n- list item',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('markdown-complex')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.whiteSpaceMode).toBe('normal')
      expect(meta.fallbackLineCount).toBeGreaterThan(0)
    })

    it('classifies markdown with code fences as complex fallback with body font', () => {
      const block: ReplayRenderableBlock = {
        id: 'md-2',
        type: 'markdown',
        text: 'Some text\n\n```typescript\nconst x = 1\n```\n\nMore text',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('markdown-complex')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.measurableText).toBeNull()
      expect(meta.fontShorthand).toBe(FONT_BODY)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_BODY_PX)
      expect(meta.fallbackLineCount).toBeGreaterThan(0)
    })

    it('classifies markdown with tables as complex fallback', () => {
      const block: ReplayRenderableBlock = {
        id: 'md-3',
        type: 'markdown',
        text: '| Col A | Col B |\n|-------|-------|\n| 1     | 2     |',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('markdown-complex')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.fontShorthand).toBe(FONT_BODY)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_BODY_PX)
      expect(meta.fallbackLineCount).toBeGreaterThan(0)
    })

    it('classifies markdown with raw HTML blocks as complex fallback', () => {
      const block: ReplayRenderableBlock = {
        id: 'md-4',
        type: 'markdown',
        text: 'Some text\n\n<div class="custom">\n  <p>Content</p>\n</div>',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('markdown-complex')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.fontShorthand).toBe(FONT_BODY)
      expect(meta.fallbackLineCount).toBeGreaterThan(0)
    })

    it('classifies code blocks as fallback with code font and line count', () => {
      const block: ReplayRenderableBlock = {
        id: 'code-1',
        type: 'code',
        text: 'const x = 1\nconst y = 2\nconst z = 3',
        language: 'typescript',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('code')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.measurableText).toBeNull()
      expect(meta.fontShorthand).toBe(FONT_CODE)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_CODE_PX)
      expect(meta.fallbackLineCount).toBe(3)
    })

    it('classifies json blocks as fallback with code font and line count', () => {
      const block: ReplayRenderableBlock = {
        id: 'json-1',
        type: 'json',
        text: '{\n  "key": "value"\n}',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('json')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.fontShorthand).toBe(FONT_CODE)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_CODE_PX)
      expect(meta.fallbackLineCount).toBe(3)
    })

    it('classifies tool blocks as fallback with disclosure font', () => {
      const block: ReplayRenderableBlock = {
        id: 'tool-1',
        type: 'tool',
        name: 'Read',
        status: 'completed',
        input: { file_path: 'src/App.tsx' },
        output: 'file content here\nsecond line',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('tool')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.measurableText).toBeNull()
      expect(meta.fontShorthand).toBe(FONT_DISCLOSURE)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_DISCLOSURE_PX)
      expect(meta.fallbackLineCount).toBeGreaterThan(0)
    })

    it('classifies meta disclosure blocks as fallback with disclosure font', () => {
      const block: ReplayMetaBlock = {
        id: 'meta-1',
        type: 'meta',
        kind: 'runtime-bootstrap',
        appearance: 'disclosure',
        label: 'Runtime',
        title: 'Bootstrap config',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('meta')
      expect(meta.pretextEligible).toBe(false)
      expect(meta.measurableText).toBeNull()
      expect(meta.fontShorthand).toBe(FONT_DISCLOSURE)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_DISCLOSURE_PX)
      expect(meta.fallbackLineCount).toBeGreaterThan(0)
    })

    it('classifies inline meta pills as fallback with body font', () => {
      const block: ReplayMetaBlock = {
        id: 'meta-inline',
        type: 'meta',
        kind: 'skill-load',
        appearance: 'inline',
        label: 'Skill',
        title: 'loaded',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('meta')
      expect(meta.fontShorthand).toBe(FONT_BODY)
      expect(meta.lineHeightPx).toBe(LINE_HEIGHT_BODY_PX)
      expect(meta.fallbackLineCount).toBe(1)
    })

    it('always provides fontShorthand and lineHeightPx regardless of eligibility', () => {
      const eligible: ReplayRenderableBlock = { id: 't', type: 'text', text: 'hi' }
      const fallback: ReplayRenderableBlock = { id: 'c', type: 'code', text: 'x' }

      expect(classifyBlock(eligible).fontShorthand).toEqual(expect.any(String))
      expect(classifyBlock(eligible).lineHeightPx).toEqual(expect.any(Number))
      expect(classifyBlock(fallback).fontShorthand).toEqual(expect.any(String))
      expect(classifyBlock(fallback).lineHeightPx).toEqual(expect.any(Number))
    })

    it('returns at least 1 fallback line for empty text blocks', () => {
      const block: ReplayRenderableBlock = {
        id: 'empty-code',
        type: 'code',
        text: '',
      }

      const meta = classifyBlock(block)

      expect(meta.category).toBe('code')
      expect(meta.fallbackLineCount).toBe(1)
    })

    it('returns empty string as measurable text for empty pretext-eligible blocks', () => {
      const block: ReplayRenderableBlock = {
        id: 'empty-text',
        type: 'text',
        text: '',
      }

      const meta = classifyBlock(block)

      expect(meta.pretextEligible).toBe(true)
      expect(meta.measurableText).toBe('')
    })
  })

  describe('stripInlineMarkdown', () => {
    it('removes heading markers', () => {
      expect(stripInlineMarkdown('## Heading')).toBe('Heading')
      expect(stripInlineMarkdown('### Sub heading')).toBe('Sub heading')
      expect(stripInlineMarkdown('# Top level')).toBe('Top level')
    })

    it('removes bold and italic markers', () => {
      expect(stripInlineMarkdown('**bold** text')).toBe('bold text')
      expect(stripInlineMarkdown('*italic* text')).toBe('italic text')
      expect(stripInlineMarkdown('__bold__ text')).toBe('bold text')
      expect(stripInlineMarkdown('_italic_ text')).toBe('italic text')
    })

    it('extracts link text from markdown links', () => {
      expect(stripInlineMarkdown('[click here](https://example.com)')).toBe('click here')
    })

    it('extracts alt text from images', () => {
      expect(stripInlineMarkdown('![alt text](image.png)')).toBe('alt text')
    })

    it('removes inline code backticks', () => {
      expect(stripInlineMarkdown('use `npm install`')).toBe('use npm install')
    })

    it('removes list markers', () => {
      expect(stripInlineMarkdown('- item one')).toBe('item one')
      expect(stripInlineMarkdown('* item two')).toBe('item two')
      expect(stripInlineMarkdown('1. numbered')).toBe('numbered')
      expect(stripInlineMarkdown('12. numbered')).toBe('numbered')
    })

    it('removes blockquote markers', () => {
      expect(stripInlineMarkdown('> quoted text')).toBe('quoted text')
    })

    it('preserves plain text unchanged', () => {
      expect(stripInlineMarkdown('just plain text')).toBe('just plain text')
    })

    it('handles multiple formatting in one line', () => {
      const input = '## **Bold** heading with [link](url)'
      const result = stripInlineMarkdown(input)
      expect(result).toBe('Bold heading with link')
    })

    it('preserves line structure across multiline input', () => {
      const input = '## Title\n\nParagraph **one**.\n\n- item'
      const result = stripInlineMarkdown(input)
      expect(result).toBe('Title\n\nParagraph one.\n\nitem')
    })
  })
})
