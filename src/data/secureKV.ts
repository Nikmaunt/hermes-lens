import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { KV } from './kv'

/**
 * KV seam over Android-Keystore-backed storage
 * (@aparajita/capacitor-secure-storage). Secrets only — today that is the
 * agent bearer token; everything non-secret stays in plain Preferences.
 *
 * On the web (dev browser, never shipped) the plugin falls back to plain
 * localStorage — acceptable for the dev loop, irrelevant in production.
 * Every method can reject (Keystore unavailable, corrupted entry); callers
 * must fail open per the migration contract in settings/tokenStore.ts.
 */
export const secureKV: KV = {
  async get(key) {
    const value = await SecureStorage.get(key)
    return typeof value === 'string' ? value : null
  },
  async set(key, value) {
    await SecureStorage.set(key, value)
  },
  async remove(key) {
    await SecureStorage.remove(key)
  },
}
