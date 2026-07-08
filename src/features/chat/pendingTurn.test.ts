import { describe, expect, it } from 'vitest'
import type { ChatTurnView } from './chatTurn'
import { computePendingTurn } from './pendingTurn'

const running: ChatTurnView = { phase: 'running' }
const idle = {
  sending: false,
  sendError: null,
  attemptedMessage: null,
  active: null,
  view: running,
} as const

describe('computePendingTurn — the pending-bubble state machine', () => {
  it('is null when nothing is in flight', () => {
    expect(computePendingTurn(idle)).toBeNull()
  })

  it('shows a sending bubble while the POST is in flight', () => {
    expect(computePendingTurn({ ...idle, sending: true, attemptedMessage: 'hi' })).toEqual({
      userMessage: 'hi',
      status: 'sending',
      reply: null,
      tokensUsed: null,
      errorReason: null,
      errorMessage: null,
    })
  })

  it('shows an error bubble when the POST itself failed (offline, D-A9)', () => {
    expect(
      computePendingTurn({ ...idle, sendError: 'offline', attemptedMessage: 'hi' }),
    ).toEqual({
      userMessage: 'hi',
      status: 'error',
      reply: null,
      tokensUsed: null,
      errorReason: 'offline',
      errorMessage: null,
    })
  })

  it('shows the thinking bubble while the accepted turn runs', () => {
    expect(
      computePendingTurn({ ...idle, active: { userMessage: 'q' }, view: { phase: 'running' } }),
    ).toEqual({
      userMessage: 'q',
      status: 'thinking',
      reply: null,
      tokensUsed: null,
      errorReason: null,
      errorMessage: null,
    })
  })

  it('shows the reply and token meter when the turn is done', () => {
    expect(
      computePendingTurn({
        ...idle,
        active: { userMessage: 'q' },
        view: { phase: 'done', reply: 'A', tokensUsed: 17106 },
      }),
    ).toEqual({
      userMessage: 'q',
      status: 'done',
      reply: 'A',
      tokensUsed: 17106,
      errorReason: null,
      errorMessage: null,
    })
  })

  it('shows an error bubble with the agent message when the turn errored', () => {
    expect(
      computePendingTurn({
        ...idle,
        active: { userMessage: 'q' },
        view: { phase: 'error', reason: 'agent', message: 'boom' },
      }),
    ).toEqual({
      userMessage: 'q',
      status: 'error',
      reply: null,
      tokensUsed: null,
      errorReason: 'agent',
      errorMessage: 'boom',
    })
  })

  it('an accepted turn takes precedence over a stale send attempt', () => {
    // active is set (POST succeeded): leftover attempted/sendError are ignored.
    const p = computePendingTurn({
      sending: false,
      sendError: 'offline',
      attemptedMessage: 'old',
      active: { userMessage: 'q' },
      view: { phase: 'running' },
    })
    expect(p?.status).toBe('thinking')
    expect(p?.userMessage).toBe('q')
  })
})
