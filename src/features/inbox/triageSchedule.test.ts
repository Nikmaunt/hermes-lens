import { describe, expect, it } from 'vitest'
import { nextTriageRun } from './triageSchedule'

// Local-time helper: 10 Jul 2026 at hh:mm:ss.
const at = (h: number, m: number, s = 0) => new Date(2026, 6, 10, h, m, s)

describe('nextTriageRun', () => {
  it('picks the next slot later the same day', () => {
    expect(nextTriageRun(at(10, 0))).toEqual(at(15, 30))
    expect(nextTriageRun(at(0, 0))).toEqual(at(3, 30))
    expect(nextTriageRun(at(15, 29, 59))).toEqual(at(15, 30))
  })

  it('a run time that just passed rolls to the following slot', () => {
    // At exactly 15:30 the cron is firing right now — "next" is the future one.
    expect(nextTriageRun(at(15, 30))).toEqual(at(21, 30))
  })

  it('after the last run the next one is tomorrow 03:30', () => {
    expect(nextTriageRun(at(21, 31))).toEqual(new Date(2026, 6, 11, 3, 30))
    expect(nextTriageRun(at(23, 59, 59))).toEqual(new Date(2026, 6, 11, 3, 30))
  })

  it('rolls over month boundaries', () => {
    expect(nextTriageRun(new Date(2026, 0, 31, 22, 0))).toEqual(new Date(2026, 1, 1, 3, 30))
  })
})
