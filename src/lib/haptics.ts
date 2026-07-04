import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

/**
 * Haptic accents at gesture commit points only — swipe commits, PIN digits,
 * capture submit. Everything is fire-and-forget and a no-op in the browser.
 */
function impact(style: ImpactStyle): void {
  if (!Capacitor.isNativePlatform()) return
  void Haptics.impact({ style }).catch(() => {
    // No vibrator / restricted — silently skip.
  })
}

/** Key presses and other small acknowledgements (PIN digits). */
export function tapLight(): void {
  impact(ImpactStyle.Light)
}

/** Gesture commits: inbox swipe decided, capture sent. */
export function tapMedium(): void {
  impact(ImpactStyle.Medium)
}
