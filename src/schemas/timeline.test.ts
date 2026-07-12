import { describe, expect, it } from 'vitest'
import { TimelineResponse } from '@/schemas'

/*
 * Contract-evolution tests: the timeline is a response surface, so a newer
 * sidecar must be able to add categories and kinds without breaking an older
 * app. These pin the two tolerance mechanisms — the OPEN category enum
 * (.catch('system')) and the free-string `kind`.
 */
describe('timeline response tolerance', () => {
  const base = {
    id: 'ev-1',
    at: '2026-07-11T09:00:00+02:00',
    category: 'capture',
    title: 'Note captured',
    detail: null,
    relatedId: null,
  }

  it('an unknown category parses and degrades to system', () => {
    const parsed = TimelineResponse.parse({
      events: [{ ...base, category: 'finance' }],
      nextBefore: null,
    })
    expect(parsed.events.map((e) => e.category)).toEqual(['system'])
  })

  it('known categories pass through untouched', () => {
    const parsed = TimelineResponse.parse({ events: [base], nextBefore: null })
    expect(parsed.events.map((e) => e.category)).toEqual(['capture'])
  })

  it('kind is optional (older sidecar sends none) and any string is accepted', () => {
    const parsed = TimelineResponse.parse({
      events: [base, { ...base, id: 'ev-2', kind: 'some-brand-new-kind' }],
      nextBefore: null,
    })
    expect(parsed.events.map((e) => e.kind)).toEqual([undefined, 'some-brand-new-kind'])
  })

  it('one exotic event never poisons the rest of the page', () => {
    const parsed = TimelineResponse.parse({
      events: [
        { ...base, id: 'ev-1', category: 'workout', kind: 'workout-logged' },
        { ...base, id: 'ev-2' },
      ],
      nextBefore: null,
    })
    expect(parsed.events.map((e) => e.category)).toEqual(['system', 'capture'])
  })
})
