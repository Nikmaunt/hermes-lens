import { describe, expect, it } from 'vitest'
import { parseIsoDate } from './dates'
import { snoozeNextMonday, snoozeTomorrow } from './snooze'

/*
 * Snooze targets are computed on the client from the device's local "today".
 * The calendar math must survive month and year boundaries, and "next
 * Monday" on a Monday must mean a full week ahead, never today.
 */
describe('snooze date math', () => {
  it('tomorrow crosses a month boundary', () => {
    expect(snoozeTomorrow(parseIsoDate('2026-07-31'))).toBe('2026-08-01')
  })

  it('tomorrow crosses a year boundary', () => {
    expect(snoozeTomorrow(parseIsoDate('2026-12-31'))).toBe('2027-01-01')
  })

  it('next Monday from a Friday crosses the month boundary', () => {
    // 2026-07-31 is a Friday; the next Monday is 3 August.
    expect(snoozeNextMonday(parseIsoDate('2026-07-31'))).toBe('2026-08-03')
  })

  it('next Monday from New Year\'s Eve lands in the next year', () => {
    // 2026-12-31 is a Thursday; the next Monday is 4 January 2027.
    expect(snoozeNextMonday(parseIsoDate('2026-12-31'))).toBe('2027-01-04')
  })

  it('next Monday from a Monday is a full week ahead, not today', () => {
    // 2026-07-06 is a Monday.
    expect(snoozeNextMonday(parseIsoDate('2026-07-06'))).toBe('2026-07-13')
  })

  it('next Monday from a Sunday is tomorrow', () => {
    // 2026-07-05 is a Sunday.
    expect(snoozeNextMonday(parseIsoDate('2026-07-05'))).toBe('2026-07-06')
  })

  it('handles the leap-day window', () => {
    // 2028 is a leap year; 2028-02-28 is a Monday.
    expect(snoozeTomorrow(parseIsoDate('2028-02-28'))).toBe('2028-02-29')
    expect(snoozeNextMonday(parseIsoDate('2028-02-28'))).toBe('2028-03-06')
  })
})
