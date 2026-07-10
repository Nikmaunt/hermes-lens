import type { KV } from '@/data/kv'

/**
 * Out-of-band config channel for the future native notification listener
 * (same pattern as widget:summary): the web app mirrors the relevant settings
 * into this Preferences key on every change, and the native service reads it
 * straight from SharedPreferences — no JS round-trip while the app is closed.
 * A missing key means "disabled, empty allowlist".
 */
export interface NotifConfig {
  enabled: boolean
  allowlist: string[]
  v: 1
}

export const NOTIF_CONFIG_KEY = 'notif:config'

export async function writeNotifConfig(
  kv: KV,
  opts: { enabled: boolean; allowlist: string[] },
): Promise<void> {
  const config: NotifConfig = { enabled: opts.enabled, allowlist: opts.allowlist, v: 1 }
  await kv.set(NOTIF_CONFIG_KEY, JSON.stringify(config))
}

/**
 * Loose Android package-name shape check for the allowlist editor: dot-joined
 * Java identifiers, at least two segments. Deliberately permissive — the
 * allowlist only has to catch obvious junk, not validate against the Play Store.
 */
export function looksLikePackageName(value: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(value)
}
