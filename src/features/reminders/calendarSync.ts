import type { KV } from '@/data/kv'
import type { RemindersResponse, Reminder } from '@/schemas'
import type { CalendarBridgePlugin } from './calendarBridge'
import { linkCreated, planCalendarSync, type ReminderLinks } from './calendarDiff'

const STATE_KEY = 'calendar-sync:v1'

/** Default event length; reminders are moments, not meetings. */
const EVENT_DURATION_MS = 30 * 60_000
/** Alarm fallback when the agent gave no leadTimeMinutes. */
const DEFAULT_LEAD_MINUTES = 30

interface SyncState {
  revision: string
  calendarId: string
  links: ReminderLinks
}

async function loadState(kv: KV): Promise<SyncState | null> {
  const raw = await kv.get(STATE_KEY)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as SyncState
  } catch {
    return null
  }
}

function eventFields(reminder: Reminder) {
  const startMs = new Date(reminder.dueAt).getTime()
  const descriptionParts = [reminder.notes, reminder.critical ? '❗ critical' : null, 'via Hermes']
  return {
    title: reminder.title,
    description: descriptionParts.filter((p): p is string => p != null && p !== '').join('\n'),
    startMs,
    endMs: startMs + EVENT_DURATION_MS,
    reminderMinutes: reminder.leadTimeMinutes ?? DEFAULT_LEAD_MINUTES,
  }
}

/**
 * Mirror the reminders feed into the device calendar. Runs only on
 * foreground refreshes (the caller gates that); an unchanged feed revision
 * against the same calendar is a no-op. Identity, duplicate-prevention and
 * user-deletion tombstones live in calendarDiff.ts (unit-tested pure logic).
 *
 * Returns whether a new revision was applied (→ caller sends the sync ack).
 */
export async function runCalendarSync(opts: {
  reminders: RemindersResponse
  /** Settings value: '' = the on-device Hermes calendar. */
  calendarTargetId: string
  kv: KV
  bridge: CalendarBridgePlugin
}): Promise<{ applied: boolean }> {
  const { reminders, kv, bridge } = opts
  const state = await loadState(kv)

  const calendarId =
    opts.calendarTargetId !== '' ? opts.calendarTargetId : (await bridge.ensureLocalCalendar()).id

  if (state !== null && state.revision === reminders.revision && state.calendarId === calendarId) {
    return { applied: false }
  }

  let links: ReminderLinks = state?.links ?? {}

  // Target calendar changed: best-effort cleanup of the events we created in
  // the old one, then start from a clean slate (no tombstones carried over).
  if (state !== null && state.calendarId !== calendarId) {
    const oldIds = Object.values(state.links)
      .filter((l) => !l.deletedByUser)
      .map((l) => l.eventId)
    if (oldIds.length > 0) {
      const { existing } = await bridge.queryEvents({
        calendarId: state.calendarId,
        eventIds: oldIds,
      })
      for (const eventId of existing) await bridge.deleteEvent({ eventId })
    }
    links = {}
  }

  const linkedIds = Object.values(links).map((l) => l.eventId)
  const existing =
    linkedIds.length > 0
      ? new Set((await bridge.queryEvents({ calendarId, eventIds: linkedIds })).existing)
      : new Set<number>()

  const plan = planCalendarSync(reminders.items, links, existing)

  for (const eventId of plan.deletes) await bridge.deleteEvent({ eventId })
  for (const { eventId, reminder } of plan.updates) {
    await bridge.updateEvent({ eventId, ...eventFields(reminder) })
  }
  let nextLinks = plan.nextLinks
  for (const reminder of plan.creates) {
    const { eventId } = await bridge.createEvent({ calendarId, ...eventFields(reminder) })
    nextLinks = linkCreated(nextLinks, reminder, eventId)
  }

  const nextState: SyncState = { revision: reminders.revision, calendarId, links: nextLinks }
  await kv.set(STATE_KEY, JSON.stringify(nextState))
  return { applied: true }
}
