import { daysUntil, formatTime, toIsoDate, toIsoDateTime } from '@/lib/dates'
import { nextTriageRun } from '@/features/inbox/triageSchedule'
import type { AgentStatus } from '@/schemas'

/*
 * The one-line system pulse under the last Today section:
 * "Synced HH:MM · backup today · next triage HH:MM". Composed entirely from
 * data the screen already holds — the today query's cache meta and the last
 * cached /api/status (the same read the widget effect performs) — so the
 * line never costs a network request.
 */

/** "Synced HH:MM" from the today query's fetchedAt cache meta. */
export function syncedFragment(fetchedAt: string): string {
  return `Synced ${formatTime(fetchedAt)}`
}

export interface BackupFragment {
  label: string
  /** True once the backup is more than a day old — the degradation accent. */
  warn: boolean
}

/**
 * Backup age from the cached /api/status; null when no status has ever been
 * cached (the fragment is omitted rather than guessed).
 */
export function backupFragment(
  status: AgentStatus | null,
  now = new Date(),
): BackupFragment | null {
  if (status === null) return null
  if (status.lastBackup === null) return { label: 'backup never', warn: true }
  // Calendar-day age: a backup from yesterday evening reads "1d ago".
  const days = -daysUntil(toIsoDate(new Date(status.lastBackup.at)), now)
  return {
    label: days <= 0 ? 'backup today' : `backup ${days}d ago`,
    warn: days > 1,
  }
}

/** "next triage HH:MM" from the hardcoded triage cron mirror. */
export function nextTriageFragment(now = new Date()): string {
  return `next triage ${formatTime(toIsoDateTime(nextTriageRun(now)))}`
}
