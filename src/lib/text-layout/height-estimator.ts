import type { BlockEstimatorMeta } from './block-estimator-types'
import type { PretextCache } from './pretext-cache'
import {
  LINE_HEIGHT_BODY_PX,
  LINE_HEIGHT_CODE_PX,
  LINE_HEIGHT_DISCLOSURE_PX,
} from './typography'

export interface BlockHeightEstimator {
  estimateBlockHeight(meta: BlockEstimatorMeta, maxWidth: number): number
  invalidateTextLayout(): void
}

/**
 * Create reusable block-height estimator backed by Pretext where possible,
 * with deterministic fallbacks for unsupported block categories.
 */
export function createBlockHeightEstimator(cache: PretextCache): BlockHeightEstimator {
  return {
    estimateBlockHeight(meta: BlockEstimatorMeta, maxWidth: number): number {
      if (meta.pretextEligible && meta.measurableText !== null) {
        const estimate = cache.estimate(
          meta.measurableText,
          meta.fontShorthand,
          maxWidth,
          meta.lineHeightPx,
          meta.whiteSpaceMode,
        )

        if (estimate) {
          return estimate.height
        }
      }

      return estimateFallbackHeight(meta)
    },

    invalidateTextLayout(): void {
      cache.clear()
    },
  }
}

export function estimateFallbackHeight(meta: BlockEstimatorMeta): number {
  const lineCount = Math.max(1, meta.fallbackLineCount ?? 1)
  return lineCount * getFallbackLineHeight(meta)
}

function getFallbackLineHeight(meta: BlockEstimatorMeta): number {
  switch (meta.category) {
    case 'tool':
    case 'code':
    case 'json':
      return LINE_HEIGHT_CODE_PX
    case 'meta':
    case 'thinking':
      return LINE_HEIGHT_DISCLOSURE_PX
    case 'markdown-complex':
    case 'markdown-simple':
    case 'text':
      return LINE_HEIGHT_BODY_PX
    default:
      return LINE_HEIGHT_BODY_PX
  }
}
