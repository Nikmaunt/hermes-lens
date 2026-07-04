import type { Reminder } from '@/schemas'

/**
 * Pure upsert/diff logic for mirroring the reminders feed into the device
 * calendar. Deliberately free of any Android/Capacitor import so the
 * critical guarantees — re-sync produces zero duplicates, user-deleted
 * events are never resurrected — are provable in plain unit tests.
 *
 * SYNC_DATA1-9 and ExtendedProperties are sync-adapter-only columns, so
 * identity lives here instead: a persisted reminderId → event _ID map
 * (`ReminderLinks`), with the device re-queried each sync to detect user
 * deletions.
 */

export interface ReminderLink {
  /** CalendarContract.Events._ID of the event we created for this reminder. */
  eventId: number
  /** Fingerprint of the reminder content last written to the calendar. */
  fingerprint: string
  /** The user deleted this event on-device — never bring it back. */
  deletedByUser?: boolean
}

/** reminderId → link. Persisted on-device between syncs. */
export type ReminderLinks = Record<string, ReminderLink>

export interface CalendarSyncPlan {
  creates: Reminder[]
  updates: { eventId: number; reminder: Reminder }[]
  /** Event ids to delete because their reminder left the feed. */
  deletes: number[]
  /**
   * Link state after the plan is applied — complete except for `creates`,
   * which the caller registers via linkCreated() as event ids come back.
   */
  nextLinks: ReminderLinks
}

/** Stable digest of every field we mirror into the calendar. */
export function fingerprintOf(r: Reminder): string {
  return JSON.stringify([
    r.title,
    r.dueAt,
    r.leadTimeMinutes ?? null,
    r.notes ?? null,
    r.critical,
    r.sourceRef ?? null,
  ])
}

export function planCalendarSync(
  reminders: readonly Reminder[],
  links: ReminderLinks,
  existingEventIds: ReadonlySet<number>,
): CalendarSyncPlan {
  const creates: Reminder[] = []
  const updates: { eventId: number; reminder: Reminder }[] = []
  const deletes: number[] = []
  const nextLinks: ReminderLinks = {}
  const feedIds = new Set(reminders.map((r) => r.id))

  for (const reminder of reminders) {
    const link = links[reminder.id] as ReminderLink | undefined
    if (link === undefined) {
      creates.push(reminder)
      continue
    }
    if (link.deletedByUser) {
      // Tombstone: the user removed it from their calendar on purpose.
      nextLinks[reminder.id] = link
      continue
    }
    if (!existingEventIds.has(link.eventId)) {
      // We created it, the device no longer has it → user deleted it.
      nextLinks[reminder.id] = { ...link, deletedByUser: true }
      continue
    }
    const fingerprint = fingerprintOf(reminder)
    if (fingerprint === link.fingerprint) {
      nextLinks[reminder.id] = link
    } else {
      updates.push({ eventId: link.eventId, reminder })
      nextLinks[reminder.id] = { eventId: link.eventId, fingerprint }
    }
  }

  // Reminders that left the feed: clean up their events (unless the user
  // already deleted them) and drop the link either way.
  for (const [id, link] of Object.entries(links)) {
    if (feedIds.has(id)) continue
    if (!link.deletedByUser && existingEventIds.has(link.eventId)) deletes.push(link.eventId)
  }

  return { creates, updates, deletes, nextLinks }
}

/** Register the device event id of an applied create in the link map. */
export function linkCreated(
  links: ReminderLinks,
  reminder: Reminder,
  eventId: number,
): ReminderLinks {
  return { ...links, [reminder.id]: { eventId, fingerprint: fingerprintOf(reminder) } }
}
