import { Preferences } from '@capacitor/preferences'

/**
 * Minimal async key-value seam so cache/queue/settings logic is unit-testable
 * without Capacitor. Production uses the Preferences plugin (SharedPreferences
 * on Android); tests use MemoryKV.
 */
export interface KV {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export const preferencesKV: KV = {
  async get(key) {
    const { value } = await Preferences.get({ key })
    return value
  },
  async set(key, value) {
    await Preferences.set({ key, value })
  },
  async remove(key) {
    await Preferences.remove({ key })
  },
}

export class MemoryKV implements KV {
  private store = new Map<string, string>()
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null)
  }
  set(key: string, value: string): Promise<void> {
    this.store.set(key, value)
    return Promise.resolve()
  }
  remove(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }
}
