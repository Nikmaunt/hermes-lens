const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date of `d` as "YYYY-MM-DD". */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Full ISO-8601 timestamp with the local UTC offset. */
export function toIsoDateTime(d: Date): string {
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return (
    `${toIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

/** Parse "YYYY-MM-DD" as local midnight. */
export function parseIsoDate(iso: string): Date {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1)
}

/** Whole days from today until `isoDate` (negative = past). */
export function daysUntil(isoDate: string, now = new Date()): number {
  const target = parseIsoDate(isoDate).getTime()
  const today = parseIsoDate(toIsoDate(now)).getTime()
  return Math.round((target - today) / 86_400_000)
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** "Fri, 4 Jul" — used for day group headers and key dates. */
export function formatDay(iso: string): string {
  const d = iso.length > 10 ? new Date(iso) : parseIsoDate(iso)
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
}

/** "4 Jul 2026" */
export function formatDate(iso: string): string {
  const d = iso.length > 10 ? new Date(iso) : parseIsoDate(iso)
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

/** "09:30" from a full timestamp. */
export function formatTime(isoDateTime: string): string {
  const d = new Date(isoDateTime)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(isoDateTime: string, now = new Date()): string {
  const ms = now.getTime() - new Date(isoDateTime).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`
}

/** "today" / "tomorrow" / "in 5d" / "3d overdue" for due dates. */
export function dueLabel(isoDate: string, now = new Date()): string {
  const days = daysUntil(isoDate, now)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 1) return `in ${days}d`
  if (days === -1) return '1d overdue'
  return `${-days}d overdue`
}
