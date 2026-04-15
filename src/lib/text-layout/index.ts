/**
 * Text layout estimation module.
 *
 * Provides typography constants, block-level estimator classification,
 * and a browser-side Pretext cache for virtualized height estimation.
 */

export type { BlockEstimatorMeta, EstimatorCategory } from './block-estimator-types'
export { classifyBlock, stripInlineMarkdown } from './block-estimator'
export { createBlockHeightEstimator, estimateFallbackHeight } from './height-estimator'
export type { BlockHeightEstimator } from './height-estimator'
export type { PretextCache, PretextEstimate, PretextWhiteSpaceMode } from './pretext-cache'
export { createPretextCache, isBrowserEnvironment } from './pretext-cache'
export {
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
} from './typography'
