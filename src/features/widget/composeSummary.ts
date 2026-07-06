import { daysUntil, formatDayMonth, formatTime, toIsoDateTime } from '@/lib/dates'
import type { AgentStatus, TodaySummary } from '@/schemas'

/*
 * Widget summary v2 — the versioned JSON the app writes into the kv layer
 * (widget:summary) for TodayWidgetProvider.java. Composed entirely on the
 * client from data the app already has: the Today payload plus the last
 * cached /api/status. The widget itself never touches the network.
 */

export interface WidgetFollowUpV2 {
  title: string
  /** 'overdue' | 'today' | 'Nd' ('2d') | 'soon' (no due date). */
  due: string
}

export interface WidgetSummaryV2 {
  v: 2
  /** Set when "Hide widget details when locked" is active. */
  masked?: boolean
  /** Top-3 open follow-ups; pending (server or local) items never appear. */
  followUps: WidgetFollowUpV2[]
  followUpCount: number
  inbox: number
  /** "Visa — 13 Jul (7d)" or null when nothing is due in 30 days. */
  deadline: string | null
  /** One-line agent health, from the cached /api/status. */
  health: string
  updatedAt: string // 'HH:MM'
  updatedAtEpoch: number
}

/**
 * After this long without a fresh write the widget prefixes its stamp with
 * "stale · ". The check runs in TodayWidgetProvider.java on every re-render
 * (reboot, resize, launcher restart) — this constant is its documented
 * mirror, so a change here reminds the reviewer to change the Java side.
 */
export const WIDGET_STALE_MS = 24 * 3_600_000

export function isSummaryStale(updatedAtEpoch: number, nowEpoch: number): boolean {
  return nowEpoch - updatedAtEpoch > WIDGET_STALE_MS
}

const BACKUP_STALE_MS = 48 * 3_600_000

/** One line the widget can always show, even when everything else is hidden. */
function composeHealth(status: AgentStatus | null, now: Date): string {
  if (status === null) return 'no data'
  if (!status.gateway.alive) return 'agent offline'
  if (status.cronJobs.some((job) => job.lastResult === 'error')) return 'cron: error'
  if (status.lastBackup === null) return 'no backup'
  const age = now.getTime() - new Date(status.lastBackup.at).getTime()
  if (age > BACKUP_STALE_MS) return `backup ${Math.floor(age / 86_400_000)}d ago`
  return 'ok · backup today'
}

function dueOf(urgency: 'overdue' | 'today' | 'soon', dueDate: string | null, now: Date): string {
  if (urgency !== 'soon') return urgency
  return dueDate !== null ? `${daysUntil(dueDate, now)}d` : 'soon'
}

export interface ComposeOptions {
  /** Payload of the last successful /api/status fetch; null = no cache yet. */
  status: AgentStatus | null
  /** Ids with local pending mutations (offline queue + just-tapped). */
  pendingIds?: ReadonlySet<string>
  /** "Hide widget details when locked" (F11). */
  masked?: boolean
  now?: Date
}

export function composeWidgetSummary(
  summary: TodaySummary,
  { status, pendingIds, masked = false, now = new Date() }: ComposeOptions,
): WidgetSummaryV2 {
  const health = composeHealth(status, now)
  const stamp = {
    updatedAt: formatTime(toIsoDateTime(now)),
    updatedAtEpoch: now.getTime(),
  }

  if (masked) {
    // Locked: the widget may say how the agent feels, never what it knows.
    return { v: 2, masked: true, followUps: [], followUpCount: 0, inbox: 0, deadline: null, health, ...stamp }
  }

  const open = summary.followUps.filter(
    (fu) => fu.pendingAction === undefined && !(pendingIds?.has(fu.id) ?? false),
  )
  const nextDeadline = summary.deadlines[0]
  return {
    v: 2,
    followUps: open.slice(0, 3).map((fu) => ({
      title: fu.title,
      due: dueOf(fu.urgency, fu.dueDate, now),
    })),
    followUpCount: open.length,
    inbox: summary.inboxCount,
    deadline:
      nextDeadline !== undefined
        ? `${nextDeadline.title} — ${formatDayMonth(nextDeadline.date)} (${
            nextDeadline.daysLeft === 0 ? 'today' : `${nextDeadline.daysLeft}d`
          })`
        : null,
    health,
    ...stamp,
  }
}
