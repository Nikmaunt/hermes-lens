import { addDays, toIsoDate } from './dates'

/*
 * Snooze target dates for follow-up actions, computed on the client from the
 * device's local calendar (the server never guesses the user's timezone).
 */

/** Tomorrow's local date. */
export function snoozeTomorrow(now = new Date()): string {
  return toIsoDate(addDays(now, 1))
}

/** The next Monday strictly after today — on a Monday that is a week ahead. */
export function snoozeNextMonday(now = new Date()): string {
  const dayOfWeek = (now.getDay() + 6) % 7 // 0 = Monday
  return toIsoDate(addDays(now, 7 - dayOfWeek))
}
