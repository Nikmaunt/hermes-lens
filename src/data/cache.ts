import type { KV } from './kv'

export interface CachedPayload<T> {
  payload: T
  fetchedAt: string // ISO timestamp of the last successful fetch
}

const PREFIX = 'cache:'

/**
 * Last-good-payload cache. Every successful endpoint response is stored so
 * the app can show data (with a "stale since…" banner) when the VPS is
 * unreachable or the phone is offline.
 */
export function createEndpointCache(kv: KV) {
  return {
    async read<T>(key: string): Promise<CachedPayload<T> | null> {
      const raw = await kv.get(PREFIX + key)
      if (raw === null) return null
      try {
        return JSON.parse(raw) as CachedPayload<T>
      } catch {
        await kv.remove(PREFIX + key)
        return null
      }
    },

    async write<T>(key: string, payload: T, fetchedAt = new Date()): Promise<void> {
      const entry: CachedPayload<T> = { payload, fetchedAt: fetchedAt.toISOString() }
      await kv.set(PREFIX + key, JSON.stringify(entry))
    },
  }
}

export type EndpointCache = ReturnType<typeof createEndpointCache>
