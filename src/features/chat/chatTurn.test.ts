import { describe, expect, it } from 'vitest'
import { ApiError } from '@/data/ApiDataSource'
import type { ChatJobResponse } from '@/schemas'
import {
  CHAT_POLL_INTERVAL_MS,
  CHAT_TURN_BUDGET_MS,
  chatPollInterval,
  chatTurnView,
  type ChatPollSnapshot,
} from './chatTurn'

const running: ChatJobResponse = { jobId: 'j', status: 'running' }
const done: ChatJobResponse = {
  jobId: 'j',
  status: 'done',
  reply: 'Sam, you write sci-fi and live in Portland (Oregon).',
  finishedAt: '2026-07-08T13:11:28+02:00',
  tokensUsed: 17106,
}
const agentError: ChatJobResponse = { jobId: 'j', status: 'error', error: 'model unavailable' }

const snap = (over: Partial<ChatPollSnapshot>): ChatPollSnapshot => ({
  data: undefined,
  error: null,
  elapsedMs: 0,
  ...over,
})

describe('chat turn state machine', () => {
  it('keeps polling while running and shows the thinking phase', () => {
    const s = snap({ data: running, elapsedMs: 4_000 })
    expect(chatPollInterval(s)).toBe(CHAT_POLL_INTERVAL_MS)
    expect(chatTurnView(s)).toEqual({ phase: 'running' })
  })

  it('stops on done and surfaces the reply + token meter', () => {
    const s = snap({ data: done, elapsedMs: 40_000 })
    expect(chatPollInterval(s)).toBe(false)
    expect(chatTurnView(s)).toEqual({ phase: 'done', reply: done.reply, tokensUsed: 17106 })
  })

  it('stops on an agent-side error and carries its message', () => {
    const s = snap({ data: agentError, elapsedMs: 40_000 })
    expect(chatPollInterval(s)).toBe(false)
    expect(chatTurnView(s)).toEqual({
      phase: 'error',
      reason: 'agent',
      message: 'model unavailable',
    })
  })

  it('treats a 404 poll as an expired turn and stops (D-A6)', () => {
    const s = snap({ data: running, error: new ApiError('gone', 'server', 404), elapsedMs: 5_000 })
    expect(chatPollInterval(s)).toBe(false)
    expect(chatTurnView(s)).toEqual({ phase: 'error', reason: 'expired', message: null })
  })

  it('keeps polling through a transient poll failure until the budget', () => {
    // A network blip mid-turn must not abandon the turn: stay "thinking",
    // keep polling. Only a 404 or the budget ends it.
    const s = snap({ data: running, error: new ApiError('offline', 'network'), elapsedMs: 6_000 })
    expect(chatPollInterval(s)).toBe(CHAT_POLL_INTERVAL_MS)
    expect(chatTurnView(s)).toEqual({ phase: 'running' })
  })

  it('gives up when the polling budget is exhausted while still running', () => {
    const s = snap({ data: running, elapsedMs: CHAT_TURN_BUDGET_MS + 1 })
    expect(chatPollInterval(s)).toBe(false)
    expect(chatTurnView(s)).toEqual({ phase: 'error', reason: 'timeout', message: null })
  })

  it('a job that finished right at the boundary still counts as done', () => {
    // Terminal state wins over the budget: we already have the reply.
    const s = snap({ data: done, elapsedMs: CHAT_TURN_BUDGET_MS + 5_000 })
    expect(chatTurnView(s).phase).toBe('done')
    expect(chatPollInterval(s)).toBe(false)
  })

  it('cold start with nothing yet is still the thinking phase and polls', () => {
    const s = snap({ elapsedMs: 500 })
    expect(chatPollInterval(s)).toBe(CHAT_POLL_INTERVAL_MS)
    expect(chatTurnView(s)).toEqual({ phase: 'running' })
  })
})
