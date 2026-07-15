export const PLAYBACK_VIEWPORT_MANIFEST = {
  states: {
    underflow: 'underflow-bottom-anchored',
    overflow: 'overflow-scrollable',
    detached: 'user-detached',
  },
  programmaticScrollGuardMs: 150,
  userScrollIntentWindowMs: 500,
} as const

export type PlaybackViewportState =
  typeof PLAYBACK_VIEWPORT_MANIFEST.states[keyof typeof PLAYBACK_VIEWPORT_MANIFEST.states]

export function deriveViewportState(
  hasOverflow: boolean,
  userDetached: boolean,
): PlaybackViewportState {
  if (userDetached) return PLAYBACK_VIEWPORT_MANIFEST.states.detached
  if (hasOverflow) return PLAYBACK_VIEWPORT_MANIFEST.states.overflow
  return PLAYBACK_VIEWPORT_MANIFEST.states.underflow
}
