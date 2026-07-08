import { describe, expect, it } from 'vitest'
import { ChatJobResponse, ChatStartRequest, ChatStartResponse, ChatStatus } from '@/schemas'

/*
 * Contract test for the chat schemas.
 *
 * Unlike the rest of the app, the source of truth here is the LIVE, already-
 * deployed sidecar: the server shipped these exact shapes to prod before this
 * schema existed (see the decision note atop schemas/chat.ts). The fixtures
 * below are verbatim prod payloads — including the real "done" reply captured
 * with curl. If a schema drifts from what the sidecar actually returns, this
 * fails loudly.
 */
describe('chat schemas honor the live sidecar contract', () => {
  it('accepts exactly the three job statuses the sidecar reports', () => {
    expect(ChatStatus.options).toEqual(['running', 'done', 'error'])
    expect(ChatStatus.safeParse('queued').success).toBe(false)
  })

  it('parses a start request — message + clientId required, sessionId optional', () => {
    const first = { message: 'who am I?', clientId: 'cli-abc' }
    expect(ChatStartRequest.parse(first)).toEqual(first)

    const continued = { message: 'and where?', clientId: 'cli-def', sessionId: 'sess-1' }
    expect(ChatStartRequest.parse(continued)).toEqual(continued)

    // clientId is mandatory — it is the server's dedup key (D-A8).
    expect(ChatStartRequest.safeParse({ message: 'hi' }).success).toBe(false)
    // An empty message is not a turn.
    expect(ChatStartRequest.safeParse({ message: '', clientId: 'x' }).success).toBe(false)
  })

  it('parses the start response — running, carrying the session to continue', () => {
    const started = { jobId: 'job-1a2b', sessionId: 'sess-1', status: 'running' }
    const parsed = ChatStartResponse.parse(started)
    expect(parsed.jobId).toBe('job-1a2b')
    expect(parsed.sessionId).toBe('sess-1')
    expect(parsed.status).toBe('running')
  })

  it('parses a running job — no reply, no finish time yet', () => {
    const running = { jobId: 'job-1a2b', status: 'running' }
    const parsed = ChatJobResponse.parse(running)
    expect(parsed.status).toBe('running')
    expect(parsed.reply).toBeUndefined()
    expect(parsed.finishedAt).toBeUndefined()
  })

  it('parses a done job verbatim from prod — reply + finishedAt + tokensUsed', () => {
    // Captured live via curl (see task brief).
    const done = {
      jobId: 'job-8f3c1e',
      status: 'done',
      reply: 'Sam, you write sci-fi and live in Portland (Oregon).',
      finishedAt: '2026-07-08T13:11:28+02:00',
      tokensUsed: 17106,
    }
    const parsed = ChatJobResponse.parse(done)
    expect(parsed.status).toBe('done')
    expect(parsed.reply).toBe(done.reply)
    expect(parsed.finishedAt).toBe(done.finishedAt)
    expect(parsed.tokensUsed).toBe(17106)
  })

  it('parses an error job — an error string, no reply', () => {
    const errored = { jobId: 'job-8f3c1e', status: 'error', error: 'model unavailable' }
    const parsed = ChatJobResponse.parse(errored)
    expect(parsed.status).toBe('error')
    expect(parsed.error).toBe('model unavailable')
    expect(parsed.reply).toBeUndefined()
  })

  it('rejects a finishedAt that is not an offset ISO datetime', () => {
    expect(
      ChatJobResponse.safeParse({ jobId: 'j', status: 'done', finishedAt: 'yesterday' }).success,
    ).toBe(false)
  })
})
