import type { TriageDestination } from '@/schemas'

/*
 * "gone" is success-by-staleness: an Undo arrived after the agent had already
 * processed the original mutation, so there was nothing left to cancel. A bare
 * "Already processed by agent" leaves the user wondering where their note went.
 * These outcomes name what actually happened and, when the result lives on a
 * *different* screen, offer a link to go see it.
 */

export interface GoneOutcome {
  /** Honest one-line explanation of what the agent did. */
  message: string
  /**
   * Present only when the result is worth jumping to from another screen.
   * Undos that fire on the destination's own screen (habits, follow-ups) omit
   * it — a link back to the screen you're already on is just noise.
   */
  link?: { label: string; route: string }
}

/**
 * Where a triaged inbox note ends up. Recovered from the original triage's
 * destination (the ProcessingEntry / queued mutation), never hardcoded to one
 * case: memory and task live elsewhere and get a link; note/archive/trash have
 * nowhere to look, so the message stands alone.
 */
export function triageGoneOutcome(destination: TriageDestination): GoneOutcome {
  switch (destination) {
    case 'memory':
      return {
        message: 'The agent already saved this to memory',
        link: { label: 'Open Memory', route: '/memory' },
      }
    case 'task':
      return {
        message: 'The agent already turned this into a task',
        link: { label: 'Open Today', route: '/' },
      }
    case 'note':
      return { message: 'The agent already saved this as a note' }
    case 'archive':
      return { message: 'The agent already archived this' }
    case 'trash':
      return { message: 'The agent already discarded this' }
  }
}

/** Follow-up done/snooze undo, on the Today screen — resolves in place. */
export const followupGoneMessage = 'The agent already resolved this follow-up'

/** Habit tick undo, on the Habits screen — the completion already stands. */
export const habitGoneMessage = 'The agent already recorded this tick'
