import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { loadPinnedBriefIds, toggleBriefPin } from './pinStore'

/*
 * Pinned briefs are client-only, like the read-set: an id-set in the kv
 * layer under "briefs:pinned". Toggling the same id pins and unpins.
 */
describe('briefs pin-set', () => {
  it('starts empty; toggling pins and unpins an id', async () => {
    const kv = new MemoryKV()
    expect((await loadPinnedBriefIds(kv)).size).toBe(0)

    let pinned = await toggleBriefPin(kv, 'brief-a')
    expect(pinned.has('brief-a')).toBe(true)

    pinned = await toggleBriefPin(kv, 'brief-a')
    expect(pinned.has('brief-a')).toBe(false)
    expect(pinned.size).toBe(0)
  })

  it('keeps multiple pins and persists through the kv layer', async () => {
    const kv = new MemoryKV()
    await toggleBriefPin(kv, 'brief-a')
    await toggleBriefPin(kv, 'brief-b')
    const pinned = await loadPinnedBriefIds(kv)
    expect(pinned.has('brief-a')).toBe(true)
    expect(pinned.has('brief-b')).toBe(true)
    expect(JSON.parse((await kv.get('briefs:pinned')) ?? '[]')).toHaveLength(2)
  })

  it('survives corrupted storage by falling back to empty', async () => {
    const kv = new MemoryKV()
    await kv.set('briefs:pinned', '{broken')
    expect((await loadPinnedBriefIds(kv)).size).toBe(0)
    const pinned = await toggleBriefPin(kv, 'brief-a')
    expect(pinned.has('brief-a')).toBe(true)
  })
})
