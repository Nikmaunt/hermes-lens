import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import type { RemindersResponse } from '@/schemas'
import type { CalendarBridgePlugin, DeviceCalendar } from './calendarBridge'
import { runCalendarSync } from './calendarSync'

/** In-memory stand-in for the native calendar. */
class FakeBridge implements CalendarBridgePlugin {
  events = new Map<number, { calendarId: string; title: string }>()
  private nextId = 1
  localCalendarId = '42'

  checkPermissions(): Promise<{ calendar: 'granted' }> {
    return Promise.resolve({ calendar: 'granted' })
  }
  requestPermissions(): Promise<{ calendar: 'granted' }> {
    return Promise.resolve({ calendar: 'granted' })
  }
  listCalendars(): Promise<{ calendars: DeviceCalendar[] }> {
    return Promise.resolve({ calendars: [] })
  }
  ensureLocalCalendar(): Promise<{ id: string }> {
    return Promise.resolve({ id: this.localCalendarId })
  }
  queryEvents({ calendarId, eventIds }: { calendarId: string; eventIds: number[] }) {
    const existing = eventIds.filter((id) => this.events.get(id)?.calendarId === calendarId)
    return Promise.resolve({ existing })
  }
  createEvent(options: { calendarId: string; title: string }) {
    const eventId = this.nextId++
    this.events.set(eventId, { calendarId: options.calendarId, title: options.title })
    return Promise.resolve({ eventId })
  }
  updateEvent(options: { eventId: number; title: string }) {
    const event = this.events.get(options.eventId)
    if (event) event.title = options.title
    return Promise.resolve()
  }
  deleteEvent({ eventId }: { eventId: number }) {
    this.events.delete(eventId)
    return Promise.resolve()
  }
}

const feed = (revision: string, titles: string[]): RemindersResponse => ({
  revision,
  items: titles.map((title, i) => ({
    id: `rem-${i}`,
    title,
    dueAt: '2026-07-10T10:00:00+02:00',
    critical: false,
  })),
})

describe('runCalendarSync', () => {
  it('creates events on first sync and is a pure no-op on the same revision', async () => {
    const kv = new MemoryKV()
    const bridge = new FakeBridge()

    const first = await runCalendarSync({
      reminders: feed('rev-1', ['A', 'B']),
      calendarTargetId: '',
      kv,
      bridge,
    })
    expect(first.applied).toBe(true)
    expect(bridge.events.size).toBe(2)

    const second = await runCalendarSync({
      reminders: feed('rev-1', ['A', 'B']),
      calendarTargetId: '',
      kv,
      bridge,
    })
    expect(second.applied).toBe(false)
    expect(bridge.events.size).toBe(2) // zero duplicates
  })

  it('applies a new revision as in-place updates, never duplicates', async () => {
    const kv = new MemoryKV()
    const bridge = new FakeBridge()
    await runCalendarSync({ reminders: feed('rev-1', ['A', 'B']), calendarTargetId: '', kv, bridge })

    const result = await runCalendarSync({
      reminders: feed('rev-2', ['A renamed', 'B']),
      calendarTargetId: '',
      kv,
      bridge,
    })
    expect(result.applied).toBe(true)
    expect(bridge.events.size).toBe(2)
    expect([...bridge.events.values()].map((e) => e.title)).toContain('A renamed')
  })

  it('does not resurrect an event the user deleted, across revisions', async () => {
    const kv = new MemoryKV()
    const bridge = new FakeBridge()
    await runCalendarSync({ reminders: feed('rev-1', ['A']), calendarTargetId: '', kv, bridge })

    // User deletes the event in the calendar app.
    bridge.events.clear()

    const result = await runCalendarSync({
      reminders: feed('rev-2', ['A']),
      calendarTargetId: '',
      kv,
      bridge,
    })
    expect(result.applied).toBe(true)
    expect(bridge.events.size).toBe(0) // stays deleted
  })

  it('moves events when the target calendar changes', async () => {
    const kv = new MemoryKV()
    const bridge = new FakeBridge()
    await runCalendarSync({ reminders: feed('rev-1', ['A']), calendarTargetId: '', kv, bridge })
    expect([...bridge.events.values()][0]?.calendarId).toBe('42')

    await runCalendarSync({ reminders: feed('rev-1', ['A']), calendarTargetId: '77', kv, bridge })
    const events = [...bridge.events.values()]
    expect(events).toHaveLength(1) // old one cleaned up, one fresh copy
    expect(events[0]?.calendarId).toBe('77')
  })
})
