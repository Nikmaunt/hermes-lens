import { describe, expect, it } from 'vitest'
import { INITIAL_EASE, MIN_EASE, isDue, newCard, review, type CardState } from './srs'

const TODAY = '2026-07-04'

describe('SM-2 scheduler', () => {
  it('new cards are due immediately', () => {
    const card = newCard(TODAY)
    expect(isDue(card, TODAY)).toBe(true)
    expect(card.ease).toBe(INITIAL_EASE)
  })

  it('follows the classic 1d → 6d → interval*ease ladder on "good"', () => {
    let card = newCard(TODAY)
    card = review(card, 2, TODAY)
    expect(card.intervalDays).toBe(1)
    expect(card.due).toBe('2026-07-05')

    card = review(card, 2, '2026-07-05')
    expect(card.intervalDays).toBe(6)
    expect(card.due).toBe('2026-07-11')

    card = review(card, 2, '2026-07-11')
    // ease stays 2.5 on "good": 6 * 2.5 = 15
    expect(card.intervalDays).toBe(15)
    expect(card.due).toBe('2026-07-26')
  })

  it('"easy" grows ease, "hard" shrinks it, floored at 1.3', () => {
    let card = newCard(TODAY)
    card = review(card, 3, TODAY)
    expect(card.ease).toBeCloseTo(2.6)

    card = review(card, 1, card.due)
    expect(card.ease).toBeCloseTo(2.46)

    let ground: CardState = { ...newCard(TODAY), ease: 1.32 }
    ground = review(ground, 1, TODAY)
    expect(ground.ease).toBe(MIN_EASE)
  })

  it('lapses reset progress but keep the card in rotation today', () => {
    let card = newCard(TODAY)
    card = review(card, 2, TODAY)
    card = review(card, 2, '2026-07-05')
    expect(card.reps).toBe(2)

    card = review(card, 0, '2026-07-11')
    expect(card.reps).toBe(0)
    expect(card.intervalDays).toBe(0)
    expect(card.due).toBe('2026-07-11')
    expect(card.ease).toBeCloseTo(2.18)

    // Relearning climbs the ladder again.
    card = review(card, 2, '2026-07-11')
    expect(card.intervalDays).toBe(1)
  })

  it('"hard" on a mature card grows the interval slowly', () => {
    const mature: CardState = { ease: 2.5, intervalDays: 10, reps: 5, due: TODAY }
    const next = review(mature, 1, TODAY)
    expect(next.intervalDays).toBe(12) // 10 * 1.2, not 10 * ease
  })

  it('due comparison is a plain ISO string comparison', () => {
    const card: CardState = { ease: 2.5, intervalDays: 6, reps: 2, due: '2026-07-10' }
    expect(isDue(card, '2026-07-09')).toBe(false)
    expect(isDue(card, '2026-07-10')).toBe(true)
    expect(isDue(card, '2026-08-01')).toBe(true)
  })
})
