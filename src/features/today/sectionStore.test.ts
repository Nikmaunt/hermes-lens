import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { loadSectionChoices, saveSectionChoices } from './sectionStore'

describe('today section choices', () => {
  it('starts empty so the per-section defaults stay in charge', async () => {
    const kv = new MemoryKV()
    expect(await loadSectionChoices(kv)).toEqual({})
  })

  it('round-trips user choices through the kv layer', async () => {
    const kv = new MemoryKV()
    await saveSectionChoices(kv, { agent: true, followups: false })
    expect(await loadSectionChoices(kv)).toEqual({ agent: true, followups: false })
  })

  it('shrugs off corrupt payloads and foreign shapes', async () => {
    const kv = new MemoryKV()
    await kv.set('today:sections', 'not json')
    expect(await loadSectionChoices(kv)).toEqual({})
    await kv.set('today:sections', JSON.stringify(['someday']))
    expect(await loadSectionChoices(kv)).toEqual({})
    // Unknown keys and non-boolean values are dropped, valid ones survive.
    await kv.set('today:sections', JSON.stringify({ someday: true, agent: 'yes', bogus: false }))
    expect(await loadSectionChoices(kv)).toEqual({ someday: true })
  })
})
