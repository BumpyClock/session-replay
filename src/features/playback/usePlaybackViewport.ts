import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Explicit viewport states for the playback surface.
 *
 * - `underflow-bottom-anchored` – played content fits within the viewport;
 *   transcript is bottom-aligned with no empty future space above.
 * - `overflow-scrollable` – played content exceeds the viewport; auto-follow
 *   keeps the active turn in view.
 * - `user-detached` – user manually scrolled; auto-follow is disabled so
 *   playback does not snap back.
 */
export type PlaybackViewportState =
  | 'underflow-bottom-anchored'
  | 'overflow-scrollable'
  | 'user-detached'

/** Pure derivation of viewport state from overflow and detach signals. */
export function deriveViewportState(
  hasOverflow: boolean,
  userDetached: boolean,
): PlaybackViewportState {
  if (userDetached) return 'user-detached'
  if (hasOverflow) return 'overflow-scrollable'
  return 'underflow-bottom-anchored'
}

const PROGRAMMATIC_SCROLL_GUARD_MS = 150
const USER_SCROLL_INTENT_WINDOW_MS = 500

export interface UsePlaybackViewportResult {
  /** Current explicit viewport state. */
  viewportState: PlaybackViewportState
  /** Whether auto-follow is active (underflow or overflow, not detached). */
  isAutoFollowing: boolean
  /** Ref to the scrollable content container (read-only outside the hook). */
  contentNodeRef: React.RefObject<HTMLDivElement | null>
  /** Callback ref — call when the content DOM node mounts/unmounts. */
  setContentNode: (node: HTMLDivElement | null) => void
  /** Re-measure overflow. Call after content changes (new turns, etc.). */
  checkOverflow: () => void
  /** Attach to the content container's onScroll. */
  onContentScroll: () => void
  /** Mark the next scroll event as user-initiated (wheel, drag, touch). */
  markUserScrollIntent: () => void
  /** Wrap a programmatic scroll so it is not mistaken for user interaction. */
  withProgrammaticScroll: (scroll: () => void) => void
  /** Reset to initial state (e.g. on playback restart). */
  resetViewport: () => void
}

export function usePlaybackViewport(): UsePlaybackViewportResult {
  const contentNodeRef = useRef<HTMLDivElement | null>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [userDetached, setUserDetached] = useState(false)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimeoutRef = useRef<number | null>(null)
  const userScrollIntentRef = useRef(false)
  const userScrollIntentTimeoutRef = useRef<number | null>(null)

  const viewportState = deriveViewportState(hasOverflow, userDetached)
  const isAutoFollowing = viewportState !== 'user-detached'

  const setContentNode = useCallback((node: HTMLDivElement | null) => {
    contentNodeRef.current = node
  }, [])

  const checkOverflow = useCallback(() => {
    const node = contentNodeRef.current
    if (!node) {
      setHasOverflow(false)
      return
    }
    setHasOverflow(node.scrollHeight > node.clientHeight)
  }, [])

  const clearProgrammaticScrollTracking = useCallback(() => {
    programmaticScrollRef.current = false
    if (programmaticScrollTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutRef.current)
      programmaticScrollTimeoutRef.current = null
    }
  }, [])

  const clearUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = false
    if (userScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutRef.current)
      userScrollIntentTimeoutRef.current = null
    }
  }, [])

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = true
    if (userScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutRef.current)
    }

    userScrollIntentTimeoutRef.current = window.setTimeout(() => {
      clearUserScrollIntent()
    }, USER_SCROLL_INTENT_WINDOW_MS)
  }, [clearUserScrollIntent])

  const onContentScroll = useCallback(() => {
    const node = contentNodeRef.current
    if (!node) {
      setHasOverflow(false)
      return
    }

    const overflow = node.scrollHeight > node.clientHeight
    setHasOverflow(overflow)
    if (!overflow) return

    if (userDetached) return

    if (programmaticScrollRef.current) {
      return
    }

    // Ignore bare scroll events so browser/layout-driven movement cannot
    // detach playback; only recent user gestures may transition to detached.
    if (!userScrollIntentRef.current) {
      return
    }

    clearUserScrollIntent()
    setUserDetached(true)
  }, [userDetached, clearUserScrollIntent])

  const withProgrammaticScroll = useCallback((scroll: () => void) => {
    programmaticScrollRef.current = true
    scroll()

    if (programmaticScrollTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutRef.current)
    }

    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      clearProgrammaticScrollTracking()
    }, PROGRAMMATIC_SCROLL_GUARD_MS)
  }, [clearProgrammaticScrollTracking])

  const resetViewport = useCallback(() => {
    clearProgrammaticScrollTracking()
    clearUserScrollIntent()
    setUserDetached(false)
    setHasOverflow(false)
  }, [clearProgrammaticScrollTracking, clearUserScrollIntent])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current)
      }
      if (userScrollIntentTimeoutRef.current !== null) {
        window.clearTimeout(userScrollIntentTimeoutRef.current)
      }
    }
  }, [])

  return {
    viewportState,
    isAutoFollowing,
    contentNodeRef,
    setContentNode,
    checkOverflow,
    onContentScroll,
    markUserScrollIntent,
    withProgrammaticScroll,
    resetViewport,
  }
}
