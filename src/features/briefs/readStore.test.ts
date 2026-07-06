import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { loadReadBriefIds, markAllBriefsRead, markBriefRead } from './readStore'

/*
 * Read/unread is a client-only concept: an id-set in the kv layer under
 * "briefs:read". The server never learns what was opened.
 */
describe('briefs read-set', () => {
  it('starts empty and accumulates read ids', async () => {
    const kv = new MemoryKV()
    expect((await loadReadBriefIds(kv)).size).toBe(0)

    await markBriefRead(kv, 'brief-a')
    await markBriefRead(kv, 'brief-b')
    const read = await loadReadBriefIds(kv)
    expect(read.has('brief-a')).toBe(true)
    expect(read.has('brief-b')).toBe(true)
    expect(read.size).toBe(2)
  })

  it('marking the same brief twice is idempotent', async () => {
    const kv = new MemoryKV()
    await markBriefRead(kv, 'brief-a')
    await markBriefRead(kv, 'brief-a')
    expect((await loadReadBriefIds(kv)).size).toBe(1)
  })

  it('persists through the kv layer, not component state', async () => {
    const kv = new MemoryKV()
    await markBriefRead(kv, 'brief-a')
    // A different reader over the same store sees the same set.
    const raw = await kv.get('briefs:read')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '[]')).toEqual(['brief-a'])
  })

  it('survives corrupted storage by falling back to empty', async () => {
    const kv = new MemoryKV()
    await kv.set('briefs:read', 'not json')
    expect((await loadReadBriefIds(kv)).size).toBe(0)
    // And recovers on the next write.
    await markBriefRead(kv, 'brief-a')
    expect((await loadReadBriefIds(kv)).has('brief-a')).toBe(true)
  })

  it('mark-all merges the given ids with what was already read', async () => {
    const kv = new MemoryKV()
    await markBriefRead(kv, 'brief-old')
    const read = await markAllBriefsRead(kv, ['brief-a', 'brief-b'])
    expect(read.has('brief-old')).toBe(true)
    expect(read.has('brief-a')).toBe(true)
    expect(read.has('brief-b')).toBe(true)
    expect((await loadReadBriefIds(kv)).size).toBe(3)
  })

  it('mark-all with no new ids is a no-op write-wise', async () => {
    const kv = new MemoryKV()
    await markBriefRead(kv, 'brief-a')
    const read = await markAllBriefsRead(kv, ['brief-a'])
    expect(read.size).toBe(1)
    expect(JSON.parse((await kv.get('briefs:read')) ?? '[]')).toEqual(['brief-a'])
  })
})
