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

  /*
   * FRAGILE-prefix pin: the strings below are the verbatim journal titles the
   * sidecar writes (hermes-lens-sidecar src/writes/queue.ts). If these tests
   * break, the sidecar retitled its write-acks — update QUEUED_ACK_TARGETS
   * together with this pin, or better, switch to the event `kind` once Pack 2
   * ships it.
   */
  describe('queued write-acks (title-prefix match)', () => {
    it('"Inbox triage queued" follows the item into the Inbox', () => {
      expect(timelineEventTarget('system', 'in-2', 'Inbox triage queued')).toEqual({
        route: '/inbox',
        highlightId: 'in-2',
      })
      expect(timelineEventTarget('system', null, 'Inbox triage queued')).toEqual({
        route: '/inbox',
      })
    })

    it('"Follow-up action queued" leads to Today, where the pending chip lives', () => {
      expect(timelineEventTarget('system', 'fu-4', 'Follow-up action queued')).toEqual({
        route: '/',
        highlightId: 'fu-4',
      })
    })

    it('"Note captured" journal events are capture category and already reach the Inbox', () => {
      // Sidecar maps journal type "capture" to the capture category
      // (src/domain/timeline.ts), so no title matching is involved.
      expect(timelineEventTarget('capture', 'note-slug', 'Note captured')).toEqual({
        route: '/inbox',
        highlightId: 'note-slug',
      })
    })

    it('matches by prefix, so detail-bearing titles still route', () => {
      expect(
        timelineEventTarget('system', null, 'Inbox triage queued (retry)')?.route,
      ).toBe('/inbox')
    })

    it('"Notification captured" and other system titles keep the in-place expansion', () => {
      expect(timelineEventTarget('system', 'rec-1', 'Notification captured')).toBeNull()
      expect(timelineEventTarget('system', null, 'Someday action queued')).toBeNull()
      expect(timelineEventTarget('system', null, 'Vault backup completed')).toBeNull()
    })
  })

  describe('kind-based routing (newer sidecar)', () => {
    it('routes every known kind per the kind table', () => {
      expect(timelineEventTarget('system', 'in-2', null, 'triage-queued')).toEqual({
        route: '/inbox',
        highlightId: 'in-2',
      })
      expect(timelineEventTarget('system', 'fu-4', null, 'followup-queued')).toEqual({
        route: '/',
        highlightId: 'fu-4',
      })
      expect(timelineEventTarget('capture', 'note-1', null, 'capture')).toEqual({
        route: '/inbox',
        highlightId: 'note-1',
      })
      expect(timelineEventTarget('system', 'habit-gym', null, 'habit-queued')).toEqual({
        route: '/habits',
        highlightId: 'habit-gym',
      })
      expect(timelineEventTarget('system', 'mem-3', null, 'memory-flag')).toEqual({
        route: '/memory',
        highlightId: 'mem-3',
      })
      // Notification journal records have no screen behind them: in place.
      expect(timelineEventTarget('system', 'rec-1', null, 'notification')).toBeNull()
      // Infra events lead to live agent state; nothing to flash there.
      expect(timelineEventTarget('system', 'bk-9', null, 'backup')).toEqual({ route: '/status' })
      expect(timelineEventTarget('system', null, null, 'cron')).toEqual({ route: '/status' })
    })

    it('kind wins over the FRAGILE title prefix', () => {
      // Title says triage ack, kind says notification: kind decides (inline).
      expect(
        timelineEventTarget('system', 'rec-1', 'Inbox triage queued', 'notification'),
      ).toBeNull()
      // Title unrecognizable after a sidecar retitle, kind still routes.
      expect(
        timelineEventTarget('system', 'in-2', 'Triage accepted (new title)', 'triage-queued'),
      ).toEqual({ route: '/inbox', highlightId: 'in-2' })
    })

    it('an unknown kind expands in place — the safe default', () => {
      expect(timelineEventTarget('system', 'x-1', 'Whatever', 'sync-ack')).toBeNull()
      // Even on an entity category: kind present means kind decides.
      expect(timelineEventTarget('memory', 'mem-1', 'Memory learned', 'memory-learned')).toBeNull()
    })

    it('events without kind keep the legacy title-prefix fallback', () => {
      expect(timelineEventTarget('system', 'in-2', 'Inbox triage queued', null)).toEqual({
        route: '/inbox',
        highlightId: 'in-2',
      })
      expect(timelineEventTarget('system', 'rec-1', 'Notification captured', null)).toBeNull()
    })

    it('omits the highlight hint when a kind-routed event has no related entity', () => {
      expect(timelineEventTarget('system', null, null, 'triage-queued')).toEqual({
        route: '/inbox',
      })
    })
  })
})
