import type { DataSource } from '@/data/DataSource'
import type { KV } from '@/data/kv'
import type { ChatTurnView } from './chatTurn'

/*
 * The single in-flight chat turn, persisted the instant the server accepts the
 * POST (D-A6). This is the core of the feature's production reliability: the
 * agent thinks 30–120s, but a phone can background, relock (which unmounts the
 * screen after 30s), or be killed in that window. Persisting {jobId, sessionId,
 * clientId, userMessage, startedAt} lets us re-attach by jobId when we come
 * back — the reply is never lost to an ordinary backgrounding.
 *
 * One turn at a time: a new send replaces it; a terminal view clears it. Stored
 * in preferencesKV, never secureKV — the bearer token is not here, and the
 * transcript itself is guarded by the app lock + allowBackup=false.
 */

export const ACTIVE_TURN_KEY = 'chat:active-turn'

export interface ActiveChatTurn {
  jobId: string
  sessionId: string
  /** Stable idempotency key: an inline retry reuses it so the server dedups (D-A8). */
  clientId: string
  /** The user's message, so the pending bubble redraws after a reattach. */
  userMessage: string
  /** Epoch ms when the POST was accepted — anchors the polling budget. */
  startedAt: number
}

function isActiveChatTurn(value: unknown): value is ActiveChatTurn {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    typeof t.jobId === 'string' &&
    typeof t.sessionId === 'string' &&
    typeof t.clientId === 'string' &&
    typeof t.userMessage === 'string' &&
    typeof t.startedAt === 'number'
  )
}

export async function loadActiveTurn(kv: KV): Promise<ActiveChatTurn | null> {
  const raw = await kv.get(ACTIVE_TURN_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    // Defensive: a partial or corrupt record is treated as "no active turn"
    // rather than trusted into the poll loop.
    return isActiveChatTurn(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function saveActiveTurn(kv: KV, turn: ActiveChatTurn): Promise<void> {
  await kv.set(ACTIVE_TURN_KEY, JSON.stringify(turn))
}

export async function clearActiveTurn(kv: KV): Promise<void> {
  await kv.remove(ACTIVE_TURN_KEY)
}

/**
 * Start a turn and persist its handle before returning. The save happens in the
 * same await chain as the accepted POST, so there is no window in which a job
 * exists server-side but is unknown to a reattach (D-A6). The caller supplies a
 * stable clientId (minted once at send, kept across retries) and, from the
 * second turn on, the rolling sessionId (D-A7).
 */
export async function startTurn(
  ds: DataSource,
  kv: KV,
  input: { message: string; clientId: string; sessionId?: string },
): Promise<ActiveChatTurn> {
  const res = await ds.startChat({
    message: input.message,
    clientId: input.clientId,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  })
  const turn: ActiveChatTurn = {
    jobId: res.jobId,
    sessionId: res.sessionId,
    clientId: input.clientId,
    userMessage: input.message,
    startedAt: Date.now(),
  }
  await saveActiveTurn(kv, turn)
  return turn
}

/** A turn no longer needs its persisted handle once it has left the running phase. */
export function isTerminalView(view: ChatTurnView): boolean {
  return view.phase !== 'running'
}
