import { z } from 'zod'
import { TriageDestination } from '@/schemas'
import type { KV } from '@/data/kv'
import { writeNotifConfig } from '@/features/notifications/notifConfig'

export const SwipeMapping = z.object({
  left: TriageDestination,
  right: TriageDestination,
  up: TriageDestination,
  down: TriageDestination,
})
export type SwipeMapping = z.infer<typeof SwipeMapping>

export const Settings = z.object({
  source: z.enum(['mock', 'api']).catch('mock'),
  apiBaseUrl: z.string().catch(''),
  /**
   * True once the user has explicitly chosen Demo mode or connected the
   * agent in the first-run flow — demo data must never be active silently.
   */
  configured: z.boolean().catch(false),
  // The bearer token deliberately does NOT live here: it is stored in
  // Keystore-backed secure storage (settings/tokenStore.ts) and any legacy
  // plaintext copy inside this object is migrated out on startup.
  appLock: z.boolean().catch(false),
  theme: z.enum(['dark', 'light']).catch('dark'),
  /** Mirror agent reminders into the device calendar (foreground-only). */
  calendarSyncEnabled: z.boolean().catch(false),
  /** Target calendar id; '' = the on-device local "Hermes" calendar. */
  calendarTargetId: z.string().catch(''),
  /** Blank out counts/deadline in the home-screen widget while app-lock is on. */
  widgetHideDetails: z.boolean().catch(false),
  /** Mirror allowed apps' notifications into the agent. The phone build's
   * listener service reads this via the notif:config mirror; in the browser
   * it is a harmless no-op. */
  notificationCaptureEnabled: z.boolean().catch(false),
  /** Package names whose notifications the native listener may capture. */
  notificationAllowlist: z.array(z.string()).catch([]),
  swipeMapping: SwipeMapping.catch({
    right: 'note',
    left: 'archive',
    up: 'memory',
    down: 'trash',
  }),
})
export type Settings = z.infer<typeof Settings>

export const DEFAULT_SETTINGS: Settings = Settings.parse({})

const KEY = 'settings'

export async function loadSettings(kv: KV): Promise<Settings> {
  const raw = await kv.get(KEY)
  if (raw === null) return DEFAULT_SETTINGS
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    const parsed = Settings.parse(json)
    if (!('configured' in json)) {
      // Install predating the first-run flow: a working API setup keeps
      // working untouched; mock users must make the demo choice explicitly.
      return { ...parsed, configured: parsed.source === 'api' && parsed.apiBaseUrl !== '' }
    }
    return parsed
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(kv: KV, settings: Settings): Promise<void> {
  await kv.set(KEY, JSON.stringify(settings))
  // Every save mirrors the notification config into its out-of-band
  // Preferences key, so the future native listener can never read a stale
  // copy (same pattern as widget:summary).
  await writeNotifConfig(kv, {
    enabled: settings.notificationCaptureEnabled,
    allowlist: settings.notificationAllowlist,
  })
}
