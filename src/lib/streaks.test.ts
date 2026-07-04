import { describe, expect, it } from 'vitest'
import { bestStreak, completionRate, currentStreak } from './streaks'

const TODAY = '2026-07-04'

describe('streaks', () => {
  it('counts a streak ending today', () => {
    expect(currentStreak(['2026-07-02', '2026-07-03', '2026-07-04'], TODAY)).toBe(3)
  })

  it('keeps a streak alive when today is not done yet', () => {
    expect(currentStreak(['2026-07-01', '2026-07-02', '2026-07-03'], TODAY)).toBe(3)
  })

  it('breaks after a missed day', () => {
    expect(currentStreak(['2026-07-01', '2026-07-02'], TODAY)).toBe(0)
    expect(currentStreak([], TODAY)).toBe(0)
  })

  it('crosses month boundaries', () => {
    expect(currentStreak(['2026-06-29', '2026-06-30', '2026-07-01'], '2026-07-01')).toBe(3)
  })

  it('finds the best streak anywhere in history', () => {
    expect(
      bestStreak(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-10', '2026-06-11']),
    ).toBe(3)
    expect(bestStreak([])).toBe(0)
    expect(bestStreak(['2026-06-01'])).toBe(1)
  })

  it('ignores duplicate dates', () => {
    expect(bestStreak(['2026-06-01', '2026-06-01', '2026-06-02'])).toBe(2)
    expect(currentStreak(['2026-07-04', '2026-07-04'], TODAY)).toBe(1)
  })

  it('computes completion rate over the tracked window', () => {
    // 4-day window, 2 done
    expect(completionRate(['2026-07-01', '2026-07-03'], '2026-07-01', TODAY)).toBeCloseTo(0.5)
    // dates outside the window don't count
    expect(completionRate(['2026-06-30'], '2026-07-01', TODAY)).toBe(0)
    expect(completionRate([], '2026-07-01', TODAY)).toBe(0)
  })
})
