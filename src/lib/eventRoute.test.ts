import { describe, expect, it } from 'vitest'
import { EventCategory } from '@/schemas'
import { eventTarget, timelineEventTarget } from './eventRoute'

describe('eventTarget', () => {
  it('routes every category somewhere or deliberately nowhere', () => {
    const routes = Object.fromEntries(
      EventCategory.options.map((c) => [c, eventTarget(c)?.route ?? null]),
    )
    expect(routes).toEqual({
      capture: '/inbox',
      memory: '/memory',
      system: '/status',
      habit: '/habits',
      people: '/people',
      project: '/projects',
      document: '/documents',
      agent: null, // cron/chat sessions: privacy-restricted, no detail view
    })
  })

  it('passes relatedId through as the highlight hint', () => {
    expect(eventTarget('capture', 'in-8')).toEqual({ route: '/inbox', highlightId: 'in-8' })
    expect(eventTarget('memory', 'mem-old-address')).toEqual({
      route: '/memory',
      highlightId: 'mem-old-address',
    })
  })

  it('omits the highlight hint when the event has no related entity', () => {
    expect(eventTarget('capture', null)).toEqual({ route: '/inbox' })
    expect(eventTarget('capture')).toEqual({ route: '/inbox' })
  })

  it('never routes agent events, even with a relatedId', () => {
    expect(eventTarget('agent', 'in-5')).toBeNull()
  })

  it('system events go to Status without a highlight (nothing to flash there)', () => {
    expect(eventTarget('system', 'anything')).toEqual({ route: '/status' })
  })
})

describe('timelineEventTarget', () => {
  it('keeps entity categories navigable, highlight hint included', () => {
    expect(timelineEventTarget('capture', 'in-8')).toEqual({
      route: '/inbox',
      highlightId: 'in-8',
    })
    expect(timelineEventTarget('habit', 'habit-gym')).toEqual({
      route: '/habits',
      highlightId: 'habit-gym',
    })
  })

  it('system events expand in place — the tap never opens Status', () => {
    expect(timelineEventTarget('system', 'notif-record-id')).toBeNull()
    expect(timelineEventTarget('system')).toBeNull()
  })

  it('agent events stay non-navigable', () => {
    expect(timelineEventTarget('agent', 'in-5')).toBeNull()
  })
})
