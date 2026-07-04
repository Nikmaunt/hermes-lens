import { describe, expect, it } from 'vitest'
import { daysUntil, dueLabel, formatDay, relativeTime, toIsoDate, toIsoDateTime } from './dates'

const NOW = new Date(2026, 6, 4, 12, 0, 0)

describe('dates', () => {
  it('formats ISO date and datetime', () => {
    expect(toIsoDate(NOW)).toBe('2026-07-04')
    expect(toIsoDateTime(NOW)).toMatch(/^2026-07-04T12:00:00[+-]\d{2}:\d{2}$/)
  })

  it('computes day differences across DST-agnostic boundaries', () => {
    expect(daysUntil('2026-07-04', NOW)).toBe(0)
    expect(daysUntil('2026-07-05', NOW)).toBe(1)
    expect(daysUntil('2026-07-01', NOW)).toBe(-3)
    expect(daysUntil('2026-08-04', NOW)).toBe(31)
  })

  it('labels due dates', () => {
    expect(dueLabel('2026-07-04', NOW)).toBe('today')
    expect(dueLabel('2026-07-05', NOW)).toBe('tomorrow')
    expect(dueLabel('2026-07-09', NOW)).toBe('in 5d')
    expect(dueLabel('2026-07-02', NOW)).toBe('2d overdue')
  })

  it('renders relative time buckets', () => {
    expect(relativeTime(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe('just now')
    expect(relativeTime(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('5m ago')
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago')
    expect(relativeTime(new Date(NOW.getTime() - 2 * 86_400_000).toISOString(), NOW)).toBe('2d ago')
  })

  it('formats day headers', () => {
    expect(formatDay('2026-07-04')).toBe('Sat, 4 Jul')
  })
})
