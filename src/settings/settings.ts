import { z } from 'zod'
import { TriageDestination } from '@/schemas'
import type { KV } from '@/data/kv'

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
  /** Static bearer token. Masked in the UI, never logged. */
  apiToken: z.string().catch(''),
  appLock: z.boolean().catch(false),
  theme: z.enum(['dark', 'light']).catch('dark'),
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
    return Settings.parse(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(kv: KV, settings: Settings): Promise<void> {
  await kv.set(KEY, JSON.stringify(settings))
}
