/*
 * The agent triages the inbox on its own — swipes and destination chips are
 * an optional manual override, not a chore. This mirrors the triage cron on
 * the VPS (runs at 03:30, 09:30, 15:30 and 21:30, Europe/Warsaw) and is a
 * hardcoded product fact on purpose: it only ever changes together with the
 * server cron, so a config surface would be noise. Times are interpreted in
 * the device's local timezone — the owner lives in the cron's timezone.
 */
export const TRIAGE_RUN_TIMES: readonly { hour: number; minute: number }[] = [
  { hour: 3, minute: 30 },
  { hour: 9, minute: 30 },
  { hour: 15, minute: 30 },
  { hour: 21, minute: 30 },
]

/**
 * The next scheduled triage run strictly after `now`, local time. Strictly:
 * at exactly 15:30 that run is already firing, so "next" is 21:30.
 */
export function nextTriageRun(now = new Date()): Date {
  for (const { hour, minute } of TRIAGE_RUN_TIMES) {
    const candidate = new Date(now)
    candidate.setHours(hour, minute, 0, 0)
    if (candidate.getTime() > now.getTime()) return candidate
  }
  const first = TRIAGE_RUN_TIMES[0] ?? { hour: 3, minute: 30 }
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(first.hour, first.minute, 0, 0)
  return tomorrow
}
