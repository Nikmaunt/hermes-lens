import { addDays, parseIsoDate, toIsoDate } from './dates'

/*
 * SM-2-style spaced repetition, simplified to four grades:
 *   0 = again (forgot), 1 = hard, 2 = good, 3 = easy
 * Grades map to SM-2 quality 2/3/4/5; ease-factor formula is classic SM-2.
 */

export interface CardState {
  /** Ease factor; SM-2 floor of 1.3. */
  ease: number
  /** Current inter-repetition interval in days. */
  intervalDays: number
  /** Successful repetitions in a row. */
  reps: number
  /** Next due date (ISO date). */
  due: string
}

export type Grade = 0 | 1 | 2 | 3

export const MIN_EASE = 1.3
export const INITIAL_EASE = 2.5

export function newCard(today: string): CardState {
  return { ease: INITIAL_EASE, intervalDays: 0, reps: 0, due: today }
}

function nextEase(ease: number, grade: Grade): number {
  const q = grade + 2 // 2..5 on the SM-2 scale
  const updated = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  return Math.max(MIN_EASE, Math.round(updated * 100) / 100)
}

export function review(state: CardState, grade: Grade, today: string): CardState {
  const ease = nextEase(state.ease, grade)

  if (grade === 0) {
    // Lapse: relearn from scratch today, retain (reduced) ease.
    return { ease, intervalDays: 0, reps: 0, due: today }
  }

  const reps = state.reps + 1
  let intervalDays: number
  if (reps === 1) intervalDays = 1
  else if (reps === 2) intervalDays = 6
  else intervalDays = Math.round(state.intervalDays * ease)
  // "hard" shouldn't grow the interval as fast as good/easy.
  if (grade === 1 && reps > 2) intervalDays = Math.max(1, Math.round(state.intervalDays * 1.2))
  intervalDays = Math.max(1, intervalDays)

  return {
    ease,
    intervalDays,
    reps,
    due: toIsoDate(addDays(parseIsoDate(today), intervalDays)),
  }
}

export function isDue(state: CardState, today: string): boolean {
  return state.due <= today
}
