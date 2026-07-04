import { useEffect, useRef } from 'react'
import { preferencesKV } from '@/data/kv'
import { useAckSync } from '@/hooks/mutations'
import { useReminders } from '@/hooks/queries'
import { toIsoDateTime } from '@/lib/dates'
import { useSettings } from '@/settings/SettingsProvider'
import { CalendarBridge } from './calendarBridge'
import { runCalendarSync } from './calendarSync'

/**
 * Drives the reminders → calendar sync. Mounted (by Shell) only while the
 * feature is enabled on a native platform, so the reminders feed is only
 * fetched when it is actually used. Runs on foreground refreshes of the
 * feed — never on a timer — and skips entirely when the feed revision is
 * unchanged (checked inside runCalendarSync). After applying a new revision
 * it acks through the offline-capable mutation queue.
 */
export function CalendarSyncDriver() {
  const { settings } = useSettings()
  const { data } = useReminders()
  const ackSync = useAckSync()
  const running = useRef(false)

  useEffect(() => {
    if (data === undefined || running.current) return
    running.current = true
    void (async () => {
      try {
        const perm = await CalendarBridge.checkPermissions()
        if (perm.calendar !== 'granted') return
        const { applied } = await runCalendarSync({
          reminders: data,
          calendarTargetId: settings.calendarTargetId,
          kv: preferencesKV,
          bridge: CalendarBridge,
        })
        if (applied) {
          await ackSync({ syncedAt: toIsoDateTime(new Date()), lastSeenRevision: data.revision })
        }
      } catch {
        // Best-effort: the next foreground refresh retries.
      } finally {
        running.current = false
      }
    })()
  }, [data, settings.calendarTargetId, ackSync])

  return null
}
