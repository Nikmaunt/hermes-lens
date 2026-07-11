import { describe, expect, it } from 'vitest'
import { MemoryKV } from '@/data/kv'
import {
  CHAT_TRANSCRIPT_LIMIT,
  TRANSCRIPT_KEY,
  appendExchange,
  clearTranscript,
  loadTranscript,
} from './transcript'

const exchange = (n: number) => ({
  userMessage: `q${n}`,
  reply: `a${n}`,
  sessionId: 'sess-1',
  at: '2026-07-08T13:11:28+02:00',
})

describe('chat transcript store', () => {
  it('starts empty with no session', async () => {
    const kv = new MemoryKV()
    expect(await loadTranscript(kv)).toEqual({ sessionId: null, messages: [] })
  })

  it('appends a completed exchange as user then assistant, carrying tokens', async () => {
    const kv = new MemoryKV()
    const t = await appendExchange(kv, {
      userMessage: 'who am I?',
      reply: 'Sam.',
      sessionId: 'sess-1',
      at: '2026-07-08T13:11:28+02:00',
      tokensUsed: 17106,
    })
    expect(t.sessionId).toBe('sess-1')
    expect(t.messages).toEqual([
      { role: 'user', text: 'who am I?', at: '2026-07-08T13:11:28+02:00' },
      { role: 'assistant', text: 'Sam.', at: '2026-07-08T13:11:28+02:00', tokensUsed: 17106 },
    ])
    // Persisted: a reload sees the same thing.
    expect(await loadTranscript(kv)).toEqual(t)
  })

  it('omits tokensUsed when the turn did not report any', async () => {
    const kv = new MemoryKV()
    const t = await appendExchange(kv, exchange(1))
    expect(t.messages[1]).toEqual({ role: 'assistant', text: 'a1', at: exchange(1).at })
    expect('tokensUsed' in (t.messages[1] ?? {})).toBe(false)
  })

  it('reuses one rolling sessionId across turns (D-A7)', async () => {
    const kv = new MemoryKV()
    await appendExchange(kv, exchange(1))
    const after = await appendExchange(kv, exchange(2))
    expect(after.sessionId).toBe('sess-1')
    expect(after.messages).toHaveLength(4)
    // The store is what the next send reads its sessionId from.
    expect((await loadTranscript(kv)).sessionId).toBe('sess-1')
  })

  it('caps at the most recent messages, trimming the oldest (D-A7)', async () => {
    const kv = new MemoryKV()
    for (let n = 0; n < 40; n++) await appendExchange(kv, exchange(n)) // 80 messages
    const t = await loadTranscript(kv)
    expect(t.messages).toHaveLength(CHAT_TRANSCRIPT_LIMIT)
    // Newest kept…
    expect(t.messages[t.messages.length - 1]?.text).toBe('a39')
    // …oldest dropped.
    expect(t.messages[0]?.text).not.toBe('q0')
  })

  it('applies the cap on load too — an oversized stored record trims to the newest 50', async () => {
    // A record written by an older build (or edited by hand) can exceed the
    // append-time cap; loading must not render 60 messages.
    const kv = new MemoryKV()
    const messages = Array.from({ length: 60 }, (_, n) => ({
      role: n % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `m${n}`,
      at: '2026-07-08T13:11:28+02:00',
    }))
    await kv.set(TRANSCRIPT_KEY, JSON.stringify({ sessionId: 'sess-1', messages }))

    const t = await loadTranscript(kv)
    expect(t.messages).toHaveLength(CHAT_TRANSCRIPT_LIMIT)
    // Newest kept…
    expect(t.messages[t.messages.length - 1]?.text).toBe('m59')
    expect(t.messages[0]?.text).toBe('m10')
    // …session untouched.
    expect(t.sessionId).toBe('sess-1')
  })

  it('treats malformed persisted data as an empty transcript', async () => {
    const kv = new MemoryKV()
    await kv.set(TRANSCRIPT_KEY, 'not json')
    expect(await loadTranscript(kv)).toEqual({ sessionId: null, messages: [] })
    await kv.set(TRANSCRIPT_KEY, JSON.stringify({ sessionId: 5 }))
    expect(await loadTranscript(kv)).toEqual({ sessionId: null, messages: [] })
  })

  it('clears the rolling conversation', async () => {
    const kv = new MemoryKV()
    await appendExchange(kv, exchange(1))
    expect(await clearTranscript(kv)).toEqual({ sessionId: null, messages: [] })
    expect(await loadTranscript(kv)).toEqual({ sessionId: null, messages: [] })
  })
})
