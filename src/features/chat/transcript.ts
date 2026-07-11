import type { KV } from '@/data/kv'

/*
 * The one rolling chat conversation, client-only (D-A7). Persisted in
 * preferencesKV (never secureKV) by the same JSON-under-a-key pattern as
 * briefs/readStore. Holds the rolling sessionId so every turn continues the
 * same server session, plus the last ~50 messages (older ones trimmed on
 * append) so the store cannot grow without bound. Guarded by the app lock +
 * allowBackup=false like all local data.
 */

export const TRANSCRIPT_KEY = 'chat:transcript'
/** Keep only the most recent messages; older ones are trimmed on append. */
export const CHAT_TRANSCRIPT_LIMIT = 50

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** ISO-8601 time the exchange was recorded. */
  at: string
  /** Assistant only: token spend for the turn (a small cost meter, D-A10). */
  tokensUsed?: number
}

export interface ChatTranscript {
  /** The rolling server session id; null until the first turn establishes one. */
  sessionId: string | null
  messages: ChatMessage[]
}

const empty = (): ChatTranscript => ({ sessionId: null, messages: [] })

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.text === 'string' &&
    typeof m.at === 'string' &&
    (m.tokensUsed === undefined || typeof m.tokensUsed === 'number')
  )
}

function isChatTranscript(value: unknown): value is ChatTranscript {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    (t.sessionId === null || typeof t.sessionId === 'string') &&
    Array.isArray(t.messages) &&
    t.messages.every(isChatMessage)
  )
}

export async function loadTranscript(kv: KV): Promise<ChatTranscript> {
  const raw = await kv.get(TRANSCRIPT_KEY)
  if (raw === null) return empty()
  try {
    const parsed: unknown = JSON.parse(raw)
    // Defensive: a partial or corrupt record reads as an empty conversation
    // rather than crashing the screen.
    if (!isChatTranscript(parsed)) return empty()
    // The cap holds on load too — a record that outgrew the append-time trim
    // (older build, hand-edited store) must not render unbounded.
    return parsed.messages.length > CHAT_TRANSCRIPT_LIMIT
      ? { ...parsed, messages: parsed.messages.slice(-CHAT_TRANSCRIPT_LIMIT) }
      : parsed
  } catch {
    return empty()
  }
}

/**
 * Record a completed turn (user message + agent reply) and continue the rolling
 * session. Both messages are appended and the transcript is trimmed to the last
 * CHAT_TRANSCRIPT_LIMIT. tokensUsed is stored only when the turn reported it.
 */
export async function appendExchange(
  kv: KV,
  exchange: {
    userMessage: string
    reply: string
    sessionId: string
    at: string
    tokensUsed?: number
  },
): Promise<ChatTranscript> {
  const current = await loadTranscript(kv)
  const assistant: ChatMessage = {
    role: 'assistant',
    text: exchange.reply,
    at: exchange.at,
    ...(exchange.tokensUsed === undefined ? {} : { tokensUsed: exchange.tokensUsed }),
  }
  const messages = [
    ...current.messages,
    { role: 'user' as const, text: exchange.userMessage, at: exchange.at },
    assistant,
  ].slice(-CHAT_TRANSCRIPT_LIMIT)
  const next: ChatTranscript = { sessionId: exchange.sessionId, messages }
  await kv.set(TRANSCRIPT_KEY, JSON.stringify(next))
  return next
}

/** Start a fresh conversation: drop the history and the rolling session. */
export async function clearTranscript(kv: KV): Promise<ChatTranscript> {
  await kv.remove(TRANSCRIPT_KEY)
  return empty()
}
