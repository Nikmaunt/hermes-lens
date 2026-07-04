import { describe, expect, it } from 'vitest'
import type { Reminder } from '@/schemas'
import { fingerprintOf, linkCreated, planCalendarSync, type ReminderLinks } from './calendarDiff'

const reminder = (id: string, patch: Partial<Reminder> = {}): Reminder => ({
  id,
  title: `Reminder ${id}`,
  dueAt: '2026-07-10T10:00:00+02:00',
  critical: false,
  ...patch,
})

/** Simulate a full apply of a plan: creates get sequential device ids. */
function apply(
  reminders: Reminder[],
  links: ReminderLinks,
  existing: Set<number>,
  nextEventId: { value: number },
): { links: ReminderLinks; existing: Set<number> } {
  const plan = planCalendarSync(reminders, links, existing)
  let out = plan.nextLinks
  const device = new Set(existing)
  for (const del of plan.deletes) device.delete(del)
  for (const create of plan.creates) {
    const id = nextEventId.value++
    device.add(id)
    out = linkCreated(out, create, id)
  }
  return { links: out, existing: device }
}

describe('planCalendarSync', () => {
  it('creates events for brand-new reminders', () => {
    const plan = planCalendarSync([reminder('a'), reminder('b')], {}, new Set())
    expect(plan.creates.map((r) => r.id)).toEqual(['a', 'b'])
    expect(plan.updates).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('re-sync of an unchanged feed produces zero operations (zero duplicates)', () => {
    const feed = [reminder('a'), reminder('b')]
    const counter = { value: 100 }
    const first = apply(feed, {}, new Set(), counter)

    // Same feed again, against the state the first sync left behind.
    const plan = planCalendarSync(feed, first.links, first.existing)
    expect(plan.creates).toEqual([])
    expect(plan.updates).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.nextLinks).toEqual(first.links)

    // And a third pass over that state is still a no-op.
    const again = apply(feed, plan.nextLinks, first.existing, counter)
    expect(again.existing).toEqual(first.existing)
  })

  it('updates in place when reminder content changes — never a second event', () => {
    const feed = [reminder('a')]
    const counter = { value: 100 }
    const synced = apply(feed, {}, new Set(), counter)

    const changed = [reminder('a', { title: 'Moved meeting', dueAt: '2026-07-11T09:00:00+02:00' })]
    const plan = planCalendarSync(changed, synced.links, synced.existing)
    expect(plan.creates).toEqual([])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]?.eventId).toBe(100)
    expect(plan.nextLinks.a?.fingerprint).toBe(fingerprintOf(changed[0]!))
  })

  it('does not resurrect events the user deleted on the device', () => {
    const feed = [reminder('a')]
    const counter = { value: 100 }
    const synced = apply(feed, {}, new Set(), counter)

    // User deletes the event in their calendar app → device no longer has it.
    const afterUserDelete = new Set<number>()
    const plan = planCalendarSync(feed, synced.links, afterUserDelete)
    expect(plan.creates).toEqual([]) // NOT recreated
    expect(plan.updates).toEqual([])
    expect(plan.nextLinks.a?.deletedByUser).toBe(true)

    // …and it stays gone on every subsequent sync, even if content changes.
    const changed = [reminder('a', { title: 'Changed later' })]
    const plan2 = planCalendarSync(changed, plan.nextLinks, afterUserDelete)
    expect(plan2.creates).toEqual([])
    expect(plan2.updates).toEqual([])
    expect(plan2.nextLinks.a?.deletedByUser).toBe(true)
  })

  it('deletes events whose reminder left the feed and forgets the link', () => {
    const feed = [reminder('a'), reminder('b')]
    const counter = { value: 100 }
    const synced = apply(feed, {}, new Set(), counter)

    const plan = planCalendarSync([reminder('a')], synced.links, synced.existing)
    expect(plan.deletes).toEqual([synced.links.b!.eventId])
    expect(plan.nextLinks.b).toBeUndefined()
  })

  it('drops the tombstone once the reminder leaves the feed, without deleting anything', () => {
    const links: ReminderLinks = {
      a: { eventId: 5, fingerprint: 'x', deletedByUser: true },
    }
    const plan = planCalendarSync([], links, new Set())
    expect(plan.deletes).toEqual([])
    expect(plan.nextLinks).toEqual({})
  })

  it('fingerprints every synced field', () => {
    const base = reminder('a')
    for (const patch of [
      { title: 'other' },
      { dueAt: '2026-08-01T08:00:00+02:00' },
      { leadTimeMinutes: 15 },
      { notes: 'bring documents' },
      { critical: true },
      { sourceRef: 'doc-1' },
    ] satisfies Partial<Reminder>[]) {
      expect(fingerprintOf({ ...base, ...patch })).not.toBe(fingerprintOf(base))
    }
  })
})
