import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { appendProcessingLog, loadProcessingLog } from './processingLog'

/*
 * The Processing section is fed by a client-only sliding-window log of
 * recent triages (kv key inbox:processing-log): the queue knows a triage is
 * still pending, but once it flushes and the server hides the item, only
 * this log still knows what was sent where.
 */
describe('inbox processing log', () => {
  const entry = (id: string, at: string) => ({
    itemId: id,
    text: `note ${id}`,
    destination: 'memory' as const,
    at,
  })

  it('appends and loads entries newest first', async () => {
    const kv = new MemoryKV()
    const now = new Date('2026-07-05T12:00:00+02:00')
    await appendProcessingLog(kv, entry('a', '2026-07-05T10:00:00+02:00'), now)
    await appendProcessingLog(kv, entry('b', '2026-07-05T11:00:00+02:00'), now)
    const log = await loadProcessingLog(kv, now)
    expect(log.map((e) => e.itemId)).toEqual(['b', 'a'])
  })

  it('drops entries older than the 48 h window', async () => {
    const kv = new MemoryKV()
    const now = new Date('2026-07-05T12:00:00+02:00')
    await appendProcessingLog(kv, entry('old', '2026-07-03T11:00:00+02:00'), now) // 49 h ago
    await appendProcessingLog(kv, entry('fresh', '2026-07-05T11:00:00+02:00'), now)
    expect((await loadProcessingLog(kv, now)).map((e) => e.itemId)).toEqual(['fresh'])
  })

  it('prunes stale entries when appending, keeping the store bounded', async () => {
    const kv = new MemoryKV()
    const early = new Date('2026-07-03T12:00:00+02:00')
    await appendProcessingLog(kv, entry('old', '2026-07-03T11:00:00+02:00'), early)
    const later = new Date('2026-07-06T12:00:00+02:00')
    await appendProcessingLog(kv, entry('new', '2026-07-06T11:00:00+02:00'), later)
    const raw = JSON.parse((await kv.get('inbox:processing-log')) ?? '[]') as unknown[]
    expect(raw.length).toBe(1)
  })

  it('re-triaging the same item replaces its entry instead of duplicating', async () => {
    const kv = new MemoryKV()
    const now = new Date('2026-07-05T12:00:00+02:00')
    await appendProcessingLog(kv, entry('a', '2026-07-05T10:00:00+02:00'), now)
    await appendProcessingLog(
      kv,
      { ...entry('a', '2026-07-05T11:00:00+02:00'), destination: 'archive' },
      now,
    )
    const log = await loadProcessingLog(kv, now)
    expect(log.length).toBe(1)
    expect(log[0]?.destination).toBe('archive')
  })

  it('survives corrupted storage by falling back to empty', async () => {
    const kv = new MemoryKV()
    await kv.set('inbox:processing-log', '{broken')
    expect(await loadProcessingLog(kv, new Date())).toEqual([])
  })
})
