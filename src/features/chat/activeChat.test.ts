import { describe, expect, it } from 'vitest'
import { ApiError } from '@/data/ApiDataSource'
import { MemoryKV } from '@/data/kv'
import { MockDataSource } from '@/data/MockDataSource'
import { chatTurnView } from './chatTurn'
import {
  ACTIVE_TURN_KEY,
  clearActiveTurn,
  isTerminalView,
  loadActiveTurn,
  saveActiveTurn,
  startTurn,
  type ActiveChatTurn,
} from './activeChat'

const sampleTurn: ActiveChatTurn = {
  jobId: 'job-1',
  sessionId: 'sess-1',
  clientId: 'cli-1',
  userMessage: 'who am I?',
  startedAt: 1_700_000_000_000,
}

describe('active chat turn persistence + reattach', () => {
  it('round-trips a saved turn and clears it', async () => {
    const kv = new MemoryKV()
    expect(await loadActiveTurn(kv)).toBeNull()
    await saveActiveTurn(kv, sampleTurn)
    expect(await loadActiveTurn(kv)).toEqual(sampleTurn)
    await clearActiveTurn(kv)
    expect(await loadActiveTurn(kv)).toBeNull()
  })

  it('treats malformed or partial persisted data as no active turn', async () => {
    const kv = new MemoryKV()
    await kv.set(ACTIVE_TURN_KEY, 'not json')
    expect(await loadActiveTurn(kv)).toBeNull()
    // A shape missing required fields must not be trusted.
    await kv.set(ACTIVE_TURN_KEY, JSON.stringify({ jobId: 'j', sessionId: 's' }))
    expect(await loadActiveTurn(kv)).toBeNull()
  })

  it('persists the active job the instant the server accepts the POST (D-A6)', async () => {
    const kv = new MemoryKV()
    const ds = new MockDataSource(new MemoryKV(), 0)
    const turn = await startTurn(ds, kv, { message: 'who am I?', clientId: 'cli-1' })

    // Saved together with the response: a background or kill right now keeps it.
    const saved = await loadActiveTurn(kv)
    expect(saved).not.toBeNull()
    expect(saved?.jobId).toBe(turn.jobId)
    expect(saved?.clientId).toBe('cli-1')
    expect(saved?.userMessage).toBe('who am I?')
    expect(saved?.sessionId).toBe(turn.sessionId)
    expect(typeof saved?.startedAt).toBe('number')
  })

  it('re-polls the saved jobId to done after a reattach (D-A6)', async () => {
    const kv = new MemoryKV()
    const ds = new MockDataSource(new MemoryKV(), 0)
    await startTurn(ds, kv, { message: 'ping', clientId: 'cli-1' })

    // Simulate a fresh mount: read the handle back and resume polling by jobId.
    const saved = await loadActiveTurn(kv)
    const jobId = saved?.jobId ?? ''
    expect((await ds.getChatJob(jobId)).status).toBe('running')
    const done = await ds.getChatJob(jobId)
    expect(done.status).toBe('done')
    expect(done.reply).toBeTruthy()
  })

  it('clears the persisted job once the turn is terminal (D-A6)', async () => {
    const kv = new MemoryKV()
    const ds = new MockDataSource(new MemoryKV(), 0)
    await startTurn(ds, kv, { message: 'ping', clientId: 'cli-1' })

    expect(isTerminalView({ phase: 'running' })).toBe(false)
    expect(isTerminalView({ phase: 'done', reply: 'x', tokensUsed: null })).toBe(true)
    expect(isTerminalView({ phase: 'error', reason: 'agent', message: null })).toBe(true)

    // The controller clears the persisted handle on any terminal view.
    await clearActiveTurn(kv)
    expect(await loadActiveTurn(kv)).toBeNull()
  })

  it('a 404 on reattach yields a clean expired view, never a crash (D-A6)', async () => {
    const kv = new MemoryKV()
    const ds = new MockDataSource(new MemoryKV(), 0)
    // A saved handle whose job the server no longer knows (TTL-expired / killed).
    await saveActiveTurn(kv, { ...sampleTurn, jobId: 'job-mock-gone' })
    const saved = await loadActiveTurn(kv)
    const jobId = saved?.jobId ?? ''

    let caught: unknown
    try {
      await ds.getChatJob(jobId)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(404)
    // The poll hook maps that error to an expired bubble, not an unhandled throw.
    expect(chatTurnView({ data: undefined, error: caught, elapsedMs: 0 })).toEqual({
      phase: 'error',
      reason: 'expired',
      message: null,
    })
  })
})
