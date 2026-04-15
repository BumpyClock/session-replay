import { describe, expect, it, vi } from 'vitest'
import { createBlockHeightEstimator, estimateFallbackHeight } from '../../src/lib/text-layout/height-estimator'
import type { PretextCache } from '../../src/lib/text-layout/pretext-cache'
import { LINE_HEIGHT_BODY_PX, LINE_HEIGHT_CODE_PX } from '../../src/lib/text-layout/typography'

describe('height estimator', () => {
  it('uses fallback line count when pretext is not eligible', () => {
    const meta = {
      category: 'code',
      fallbackLineCount: 3,
      fontShorthand: null,
      lineHeightPx: null,
      measurableText: null,
      pretextEligible: false,
      whiteSpaceMode: 'pre-wrap' as const,
    }

    expect(estimateFallbackHeight(meta)).toBeCloseTo(3 * LINE_HEIGHT_CODE_PX)
  })

  it('delegates to pretext cache for eligible blocks', () => {
    const cache: PretextCache = {
      clear: vi.fn(),
      estimate: vi.fn(() => ({ height: 64, lineCount: 3 })),
    }
    const estimator = createBlockHeightEstimator(cache)

    const height = estimator.estimateBlockHeight(
      {
        category: 'text',
        fallbackLineCount: null,
        fontShorthand: '15px sans-serif',
        lineHeightPx: LINE_HEIGHT_BODY_PX,
        measurableText: 'Hello world',
        pretextEligible: true,
        whiteSpaceMode: 'pre-wrap',
      },
      320,
    )

    expect(height).toBe(64)
    expect(cache.estimate).toHaveBeenCalledWith('Hello world', '15px sans-serif', 320, LINE_HEIGHT_BODY_PX, 'pre-wrap')
  })

  it('falls back when pretext returns null', () => {
    const cache: PretextCache = {
      clear: vi.fn(),
      estimate: vi.fn(() => null),
    }
    const estimator = createBlockHeightEstimator(cache)

    const height = estimator.estimateBlockHeight(
      {
        category: 'markdown-complex',
        fallbackLineCount: 2,
        fontShorthand: '15px sans-serif',
        lineHeightPx: LINE_HEIGHT_BODY_PX,
        measurableText: 'Heading',
        pretextEligible: true,
        whiteSpaceMode: 'normal',
      },
      280,
    )

    expect(height).toBeCloseTo(2 * LINE_HEIGHT_BODY_PX)
  })

  it('clears cache through invalidateTextLayout', () => {
    const cache: PretextCache = {
      clear: vi.fn(),
      estimate: vi.fn(() => ({ height: 32, lineCount: 1 })),
    }
    const estimator = createBlockHeightEstimator(cache)

    estimator.invalidateTextLayout()

    expect(cache.clear).toHaveBeenCalledTimes(1)
  })
})
