/**
 * Types for block-level height estimation metadata.
 *
 * Produced at layout-prep time and consumed later by the browser-side
 * Pretext estimator to calculate row heights without DOM reads.
 */

/**
 * Estimator categories.
 *
 * Each category determines whether Pretext can measure the block or a
 * fallback heuristic is required.
 */
export type EstimatorCategory =
  | 'code'
  | 'json'
  | 'markdown-complex'
  | 'markdown-simple'
  | 'meta'
  | 'text'
  | 'thinking'
  | 'tool'

/**
 * Per-block metadata for virtualized height estimation.
 *
 * Attached to each block during transcript layout preparation. The
 * virtualizer consumes this to derive row heights from cached Pretext
 * measurements (for eligible blocks) or deterministic fallbacks.
 *
 * Both `fontShorthand` and `lineHeightPx` are always present so the
 * virtualizer can compute heights without reimporting typography constants
 * or reparsing block categories.
 */
export interface BlockEstimatorMeta {
  /** Classification of the block for height estimation strategy. */
  category: EstimatorCategory

  /** Whether Pretext `prepare` + `layout` can accurately estimate this block's height. */
  pretextEligible: boolean

  /**
   * CSS white-space mode matching the rendered block body.
   * Passed through to Pretext `prepare` for eligible blocks; recorded
   * for completeness on fallback blocks.
   */
  whiteSpaceMode: 'normal' | 'pre-wrap'

  /**
   * Plain text content for Pretext measurement.
   * Stripped of inline markdown formatting when the source is markdown.
   * Null when the block is not pretext-eligible.
   */
  measurableText: string | null

  /**
   * CSS font shorthand for the block's body content.
   * Always present — used by Pretext `prepare` for eligible blocks and
   * by heuristic calculations for fallback blocks.
   */
  fontShorthand: string

  /**
   * Computed line height in px for the block's body content.
   * Always present — used by Pretext `layout` for eligible blocks and
   * multiplied by `fallbackLineCount` for fallback blocks.
   */
  lineHeightPx: number

  /**
   * Heuristic line count for fallback estimation.
   * Used by non-pretext-eligible blocks to derive a reasonable height.
   * Null for pretext-eligible blocks.
   */
  fallbackLineCount: number | null
}
