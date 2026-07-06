import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import type { TodaySummary } from '@/schemas'
import { composeWidgetSummary, type ComposeOptions } from './composeSummary'

/**
 * Bridge to the native home-screen widget (see TodayWidgetProvider.java).
 * The app writes a compact summary into Preferences (SharedPreferences
 * "CapacitorStorage" on Android) and asks the widget to re-render. No
 * background work: the widget only updates while the app is open.
 */
interface WidgetBridgePlugin {
  refresh(): Promise<void>
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

const SUMMARY_KEY = 'widget:summary'

/**
 * Compose and store the v2 widget summary (see composeSummary.ts for the
 * contract), then ping the provider. `masked` in the options covers
 * Settings → "Hide widget details when locked" (F11): no titles, counts or
 * deadline leak to the launcher while app lock is on.
 */
export async function updateTodayWidget(summary: TodaySummary, opts: ComposeOptions): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await Preferences.set({ key: SUMMARY_KEY, value: JSON.stringify(composeWidgetSummary(summary, opts)) })
  try {
    await WidgetBridge.refresh()
  } catch {
    // Widget not placed or plugin unavailable — nothing to do.
  }
}
