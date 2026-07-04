import { Capacitor, registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { dueLabel, formatTime, toIsoDateTime } from '@/lib/dates'
import type { TodaySummary } from '@/schemas'

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

export async function updateTodayWidget(summary: TodaySummary): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const nextDeadline = summary.deadlines[0]
  const value = JSON.stringify({
    followUps: summary.followUps.length,
    inbox: summary.inboxCount,
    deadline:
      nextDeadline !== undefined
        ? `${nextDeadline.title} · ${dueLabel(nextDeadline.date)}`
        : 'No deadlines in the next 30 days',
    updatedAt: formatTime(toIsoDateTime(new Date())),
  })
  await Preferences.set({ key: SUMMARY_KEY, value })
  try {
    await WidgetBridge.refresh()
  } catch {
    // Widget not placed or plugin unavailable — nothing to do.
  }
}
