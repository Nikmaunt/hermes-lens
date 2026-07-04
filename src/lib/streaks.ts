import { addDays, parseIsoDate, toIsoDate } from './dates'

/**
 * Current streak of consecutive days, counting back from today.
 * Today itself is optional (the day isn't over yet): a streak ending
 * yesterday is still alive.
 */
export function currentStreak(completedDates: string[], today: string): number {
  const days = new Set(completedDates)
  let cursor = today
  if (!days.has(cursor)) cursor = toIsoDate(addDays(parseIsoDate(cursor), -1))
  let streak = 0
  while (days.has(cursor)) {
    streak++
    cursor = toIsoDate(addDays(parseIsoDate(cursor), -1))
  }
  return streak
}

/** Longest run of consecutive days anywhere in the history. */
export function bestStreak(completedDates: string[]): number {
  if (completedDates.length === 0) return 0
  const sorted = [...new Set(completedDates)].sort()
  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseIsoDate(sorted[i - 1] ?? '')
    const next = toIsoDate(addDays(prev, 1))
    if (sorted[i] === next) {
      run++
      if (run > best) best = run
    } else {
      run = 1
    }
  }
  return best
}

/** Share of days completed since `startedOn` (inclusive), up to today. */
export function completionRate(
  completedDates: string[],
  startedOn: string,
  today: string,
): number {
  const start = parseIsoDate(startedOn).getTime()
  const end = parseIsoDate(today).getTime()
  const totalDays = Math.round((end - start) / 86_400_000) + 1
  if (totalDays <= 0) return 0
  const done = new Set(completedDates.filter((d) => d >= startedOn && d <= today)).size
  return Math.min(1, done / totalDays)
}
