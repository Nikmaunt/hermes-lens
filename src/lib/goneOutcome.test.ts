import { describe, expect, it } from 'vitest'
import { TriageDestination } from '@/schemas'
import {
  followupGoneMessage,
  habitGoneMessage,
  triageGoneOutcome,
} from './goneOutcome'

describe('triageGoneOutcome: destination → route', () => {
  it('links a memory triage to the Memory screen', () => {
    expect(triageGoneOutcome('memory').link).toEqual({ label: 'Open Memory', route: '/memory' })
  })

  it('links a task triage to Today', () => {
    expect(triageGoneOutcome('task').link).toEqual({ label: 'Open Today', route: '/' })
  })

  it('gives note/archive/trash a message but no link (nowhere to look)', () => {
    for (const dest of ['note', 'archive', 'trash'] as const) {
      const outcome = triageGoneOutcome(dest)
      expect(outcome.link).toBeUndefined()
      expect(outcome.message.length).toBeGreaterThan(0)
    }
  })

  it('covers every triage destination the schema allows', () => {
    for (const dest of TriageDestination.options) {
      const outcome = triageGoneOutcome(dest)
      expect(outcome.message.length).toBeGreaterThan(0)
      // A link, when present, points at a real in-app route.
      if (outcome.link !== undefined) expect(outcome.link.route.startsWith('/')).toBe(true)
    }
  })

  it('gives every outcome a distinct, honest message', () => {
    const messages = [
      ...TriageDestination.options.map((d) => triageGoneOutcome(d).message),
      followupGoneMessage,
      habitGoneMessage,
    ]
    expect(new Set(messages).size).toBe(messages.length)
    for (const m of messages) expect(m.toLowerCase()).toContain('already')
  })
})
