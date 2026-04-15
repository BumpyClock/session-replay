/**
 * Shared typography constants for text layout estimation.
 *
 * Values mirror the CSS custom properties declared in `src/index.css` so
 * the browser-side Pretext estimator produces measurements consistent with
 * the rendered styles. Keep these in sync with the stylesheet.
 */

// ---------------------------------------------------------------------------
// Font stacks
// ---------------------------------------------------------------------------

/** Sans-serif stack used by body text and markdown renders. */
export const FONT_STACK_SANS = "'Inter', 'Avenir Next', 'Segoe UI', sans-serif"

/** Monospace stack used by code blocks and tool output. */
export const FONT_STACK_MONO = 'ui-monospace, Consolas, monospace'

// ---------------------------------------------------------------------------
// Font sizes (px)
// ---------------------------------------------------------------------------

/** Root body font size. */
export const FONT_SIZE_BODY_PX = 15

/** Font size for disclosure content (thinking/tool/meta blocks). */
export const FONT_SIZE_DISCLOSURE_PX = 12.5

/** Font size for code blocks and tool output. */
export const FONT_SIZE_CODE_PX = 13

// ---------------------------------------------------------------------------
// Line height multipliers (unitless)
// ---------------------------------------------------------------------------

export const LINE_HEIGHT_TIGHT = 1.15
export const LINE_HEIGHT_BASE = 1.45
export const LINE_HEIGHT_LOOSE = 1.55

// ---------------------------------------------------------------------------
// Computed line heights (px) — font size × multiplier
// ---------------------------------------------------------------------------

/** Line height for body/markdown text: 15 × 1.55 = 23.25px. */
export const LINE_HEIGHT_BODY_PX = FONT_SIZE_BODY_PX * LINE_HEIGHT_LOOSE

/** Line height for disclosure content: 12.5 × 1.45 = 18.125px. */
export const LINE_HEIGHT_DISCLOSURE_PX = FONT_SIZE_DISCLOSURE_PX * LINE_HEIGHT_BASE

/** Line height for code: 13 × 1.45 = 18.85px. */
export const LINE_HEIGHT_CODE_PX = FONT_SIZE_CODE_PX * LINE_HEIGHT_BASE

// ---------------------------------------------------------------------------
// Pretext font shorthands — CSS `font` shorthand for canvas measurement
// ---------------------------------------------------------------------------

/** Body text / simple markdown. */
export const FONT_BODY = `${FONT_SIZE_BODY_PX}px ${FONT_STACK_SANS}`

/** Disclosure text (thinking blocks). */
export const FONT_DISCLOSURE = `${FONT_SIZE_DISCLOSURE_PX}px ${FONT_STACK_SANS}`

/** Monospace (code, JSON, tool output). */
export const FONT_CODE = `${FONT_SIZE_CODE_PX}px ${FONT_STACK_MONO}`
