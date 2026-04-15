import { describe, expect, it } from 'vitest'
import {
  FONT_BODY,
  FONT_CODE,
  FONT_DISCLOSURE,
  FONT_SIZE_BODY_PX,
  FONT_SIZE_CODE_PX,
  FONT_SIZE_DISCLOSURE_PX,
  FONT_STACK_MONO,
  FONT_STACK_SANS,
  LINE_HEIGHT_BASE,
  LINE_HEIGHT_BODY_PX,
  LINE_HEIGHT_CODE_PX,
  LINE_HEIGHT_DISCLOSURE_PX,
  LINE_HEIGHT_LOOSE,
  LINE_HEIGHT_TIGHT,
} from '../../src/lib/text-layout/typography'

describe('typography constants', () => {
  it('exports font stacks matching CSS custom properties', () => {
    expect(FONT_STACK_SANS).toContain('Inter')
    expect(FONT_STACK_MONO).toContain('monospace')
  })

  it('exports font sizes as positive pixel values', () => {
    expect(FONT_SIZE_BODY_PX).toBe(15)
    expect(FONT_SIZE_DISCLOSURE_PX).toBe(12.5)
    expect(FONT_SIZE_CODE_PX).toBe(13)
  })

  it('exports line-height multipliers matching CSS tokens', () => {
    expect(LINE_HEIGHT_TIGHT).toBe(1.15)
    expect(LINE_HEIGHT_BASE).toBe(1.45)
    expect(LINE_HEIGHT_LOOSE).toBe(1.55)
  })

    it('computes line heights as font size × multiplier', () => {
      expect(LINE_HEIGHT_BODY_PX).toBeCloseTo(FONT_SIZE_BODY_PX * LINE_HEIGHT_LOOSE)
      expect(LINE_HEIGHT_DISCLOSURE_PX).toBeCloseTo(FONT_SIZE_DISCLOSURE_PX * LINE_HEIGHT_BASE)
      expect(LINE_HEIGHT_CODE_PX).toBeCloseTo(FONT_SIZE_CODE_PX * LINE_HEIGHT_BASE)
    })

  it('produces valid CSS font shorthands for Pretext', () => {
    expect(FONT_BODY).toBe(`${FONT_SIZE_BODY_PX}px ${FONT_STACK_SANS}`)
    expect(FONT_DISCLOSURE).toBe(`${FONT_SIZE_DISCLOSURE_PX}px ${FONT_STACK_SANS}`)
    expect(FONT_CODE).toBe(`${FONT_SIZE_CODE_PX}px ${FONT_STACK_MONO}`)
  })
})
