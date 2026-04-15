/**
 * Browser-only cached Pretext adapter for text height estimation.
 *
 * Wraps `@chenglou/pretext` with a two-level cache (prepare results keyed
 * by text+font+whiteSpace, layout results keyed by prepared+width+lineHeight)
 * so the virtualizer can call `estimate()` cheaply during scroll/resize.
 *
 * Design constraint: this module must only call Pretext in browser
 * environments where canvas text measurement is available. The static import
 * is safe because Pretext is a pure-arithmetic library that defers canvas
 * access until `prepare()` is called.
 */

import { prepare, layout, clearCache as pretextClearCache } from '@chenglou/pretext'
import type { LayoutResult, PreparedText } from '@chenglou/pretext'

/** Result of a cached height estimation. */
export interface PretextEstimate {
  height: number
  lineCount: number
}

/** White-space mode passed through to Pretext's `prepare`. */
export type PretextWhiteSpaceMode = 'normal' | 'pre-wrap'

/** Cached Pretext adapter instance. */
export interface PretextCache {
  /**
   * Estimate the rendered height of `text` at the given font/width/lineHeight.
   *
   * Returns `null` if Pretext measurement is unavailable (e.g. no canvas
   * support) and the caller should fall back to heuristics.
   *
   * Returns `{ height: 0, lineCount: 0 }` for empty text.
   */
  estimate(
    text: string,
    fontShorthand: string,
    maxWidth: number,
    lineHeightPx: number,
    whiteSpaceMode: PretextWhiteSpaceMode,
  ): PretextEstimate | null

  /** Clear all cached prepare and layout results. */
  clear(): void
}

/** Check if the current environment supports canvas text measurement. */
export function isBrowserEnvironment(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  )
}

/**
 * Create a new Pretext cache instance.
 *
 * Caches prepare results keyed by text+font+whiteSpace and layout results
 * keyed by prepared ref+width+lineHeight. Handles environments where canvas
 * is unavailable by returning null estimates.
 */
export function createPretextCache(): PretextCache {
  // Cache: "text\0font\0whiteSpace" → PreparedText
  const prepareCache = new Map<string, PreparedText>()

  // Cache: PreparedText ref + "width|lineHeight" → LayoutResult
  const layoutCache = new WeakMap<PreparedText, Map<string, LayoutResult>>()

  function getPrepared(
    text: string,
    font: string,
    whiteSpaceMode: PretextWhiteSpaceMode,
  ): PreparedText | null {
    const key = `${text}\0${font}\0${whiteSpaceMode}`
    const cached = prepareCache.get(key)
    if (cached) return cached

    try {
      const prepared = prepare(text, font, { whiteSpace: whiteSpaceMode })
      prepareCache.set(key, prepared)
      return prepared
    } catch {
      return null
    }
  }

  function getLayout(
    prepared: PreparedText,
    maxWidth: number,
    lineHeightPx: number,
  ): LayoutResult | null {
    const layoutKey = `${maxWidth}|${lineHeightPx}`
    let widthCache = layoutCache.get(prepared)
    if (widthCache) {
      const cached = widthCache.get(layoutKey)
      if (cached) return cached
    }

    try {
      const result = layout(prepared, maxWidth, lineHeightPx)
      if (!widthCache) {
        widthCache = new Map()
        layoutCache.set(prepared, widthCache)
      }
      widthCache.set(layoutKey, result)
      return result
    } catch {
      return null
    }
  }

  return {
    estimate(
      text: string,
      fontShorthand: string,
      maxWidth: number,
      lineHeightPx: number,
      whiteSpaceMode: PretextWhiteSpaceMode,
    ): PretextEstimate | null {
      if (!text) {
        return { height: 0, lineCount: 0 }
      }

      const prepared = getPrepared(text, fontShorthand, whiteSpaceMode)
      if (!prepared) return null

      const result = getLayout(prepared, maxWidth, lineHeightPx)
      if (!result) return null

      return {
        height: result.height,
        lineCount: result.lineCount,
      }
    },

    clear(): void {
      prepareCache.clear()
      pretextClearCache()
    },
  }
}
