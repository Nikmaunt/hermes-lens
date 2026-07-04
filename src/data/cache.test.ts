import { describe, expect, it } from 'vitest'
import { createEndpointCache } from './cache'
import { MemoryKV } from './kv'

describe('endpoint cache', () => {
  it('round-trips payloads with a fetch timestamp', async () => {
    const cache = createEndpointCache(new MemoryKV())
    const fetchedAt = new Date('2026-07-01T10:00:00Z')
    await cache.write('mock:today', { hello: 1 }, fetchedAt)

    const entry = await cache.read<{ hello: number }>('mock:today')
    expect(entry?.payload.hello).toBe(1)
    expect(entry?.fetchedAt).toBe(fetchedAt.toISOString())
  })

  it('returns null for missing keys and drops corrupt entries', async () => {
    const kv = new MemoryKV()
    const cache = createEndpointCache(kv)
    expect(await cache.read('nope')).toBeNull()

    await kv.set('cache:bad', '{not json')
    expect(await cache.read('bad')).toBeNull()
    expect(await kv.get('cache:bad')).toBeNull()
  })
})
