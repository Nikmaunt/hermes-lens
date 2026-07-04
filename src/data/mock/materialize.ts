import { addDays, formatDate, toIsoDate, toIsoDateTime } from '@/lib/dates'

/*
 * Mock fixtures store dates as offsets relative to "now" so the bundled
 * three-week history never goes stale:
 *
 *   "@d-3"        → ISO date 3 days ago            ("2026-07-01")
 *   "@d+14"       → ISO date in 14 days            ("2026-07-18")
 *   "@t-2@09:15"  → ISO timestamp 2 days ago 09:15 ("2026-07-02T09:15:00+02:00")
 *
 * Tokens embedded inside prose ("registration opens @d+33") become
 * human-readable dates ("registration opens 6 Aug 2026") instead of ISO.
 */
const DATE_TOKEN = /^@d([+-]\d+)$/
const TIME_TOKEN = /^@t([+-]\d+)@(\d{2}):(\d{2})$/
const INLINE_DATE_TOKEN = /@d([+-]\d+)/g

function materializeString(value: string, now: Date): string {
  const dateMatch = DATE_TOKEN.exec(value)
  if (dateMatch) return toIsoDate(addDays(now, Number(dateMatch[1])))

  const timeMatch = TIME_TOKEN.exec(value)
  if (timeMatch) {
    const d = addDays(now, Number(timeMatch[1]))
    d.setHours(Number(timeMatch[2]), Number(timeMatch[3]), 0, 0)
    return toIsoDateTime(d)
  }

  return value.replace(INLINE_DATE_TOKEN, (_, offset: string) =>
    formatDate(toIsoDate(addDays(now, Number(offset)))),
  )
}

/** Recursively replace date tokens in a fixture tree. Returns a new tree. */
export function materialize<T>(value: T, now = new Date()): T {
  if (typeof value === 'string') return materializeString(value, now) as T
  if (Array.isArray(value)) return value.map((v) => materialize(v, now)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = materialize(v, now)
    return out as T
  }
  return value
}
