import { dueBadgeLabel, dueToneFor, type DueTone } from '@/lib/dates'

export type { DueTone }

const toneClasses: Record<DueTone, string> = {
  overdue: 'bg-overdue-dim text-overdue',
  warn: 'bg-warn-dim text-warn',
  neutral: 'bg-raised text-muted',
}

/**
 * The one due-date pill. Fixed height with true vertical centering, tabular
 * numerals, never wraps, and wide enough that short labels don't collapse
 * into dots. `tone` overrides the date-derived default where a screen has
 * its own urgency semantics (e.g. deadlines within 3 days).
 */
export function DueBadge({
  date,
  tone,
  prefix,
  now,
}: {
  date: string
  tone?: DueTone
  prefix?: string
  now?: Date
}) {
  const label =
    prefix !== undefined ? `${prefix} ${dueBadgeLabel(date, now)}` : dueBadgeLabel(date, now)
  return (
    <span
      className={`tnum inline-flex h-5.5 min-w-11 shrink-0 items-center justify-center rounded-full px-2.5 text-caption leading-none font-medium whitespace-nowrap ${toneClasses[tone ?? dueToneFor(date, now)]}`}
    >
      {label}
    </span>
  )
}
