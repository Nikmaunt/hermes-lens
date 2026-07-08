import { ApiError } from '@/data/ApiDataSource'
import type { ChatJobResponse } from '@/schemas'

/**
 * The polling state machine for a single chat turn, kept as pure functions so
 * the stop-conditions and budget are unit-testable without timers or a live
 * QueryClient. useChatJobPoll wires these into TanStack's refetchInterval.
 */

/** How often to poll a running job. The agent thinks 30–120s; 2s is responsive without hammering. */
export const CHAT_POLL_INTERVAL_MS = 2_000

/**
 * Hard ceiling on one turn's polling (D-A5). Past this a still-running job is
 * surfaced as timed out with inline retry — the client stops waiting even if
 * the server never answers. Comfortably above the 30–120s the agent needs.
 */
export const CHAT_TURN_BUDGET_MS = 180_000

/** Why a turn ended unhappily — drives the bubble's error copy (D-A10). */
export type ChatErrorReason =
  | 'agent' // the job itself reported status:"error"
  | 'expired' // 404 — unknown or TTL-expired jobId (D-A6)
  | 'timeout' // polling budget exhausted while still running
  | 'offline' // could not reach the agent at all
  | 'unknown'

/** What the UI renders for the active turn. */
export type ChatTurnView =
  | { phase: 'running' }
  | { phase: 'done'; reply: string; tokensUsed: number | null }
  | { phase: 'error'; reason: ChatErrorReason; message: string | null }

/** One poll's worth of state, as read off the TanStack query. */
export interface ChatPollSnapshot {
  /** Last successful poll payload, if any. */
  data: ChatJobResponse | undefined
  /** Error from the most recent poll attempt, if it failed. */
  error: unknown
  /** Milliseconds since the turn started (POST accepted). */
  elapsedMs: number
}

/** A poll came back 404: the job is unknown or its server-side TTL expired. */
function isExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/**
 * Maps a poll/transport error to a reason. Used when a turn ends on a transport
 * failure rather than an agent answer (the send path reuses this in D-A9).
 */
export function chatErrorReason(error: unknown): ChatErrorReason {
  if (isExpired(error)) return 'expired'
  if (error instanceof ApiError) {
    return error.kind === 'network' || error.kind === 'timeout' ? 'offline' : 'unknown'
  }
  return 'unknown'
}

/**
 * The turn's current view. Priority: a terminal payload (done/error) wins over
 * everything — once we have the reply the budget is moot; then an expired 404;
 * then the exhausted budget; otherwise we are still thinking. A transient poll
 * error that is not a 404 is deliberately *not* terminal (see chatPollInterval).
 */
export function chatTurnView(snap: ChatPollSnapshot): ChatTurnView {
  const { data, error, elapsedMs } = snap
  if (data?.status === 'done') {
    return { phase: 'done', reply: data.reply ?? '', tokensUsed: data.tokensUsed ?? null }
  }
  if (data?.status === 'error') {
    return { phase: 'error', reason: 'agent', message: data.error ?? null }
  }
  if (isExpired(error)) {
    return { phase: 'error', reason: 'expired', message: null }
  }
  if (elapsedMs >= CHAT_TURN_BUDGET_MS) {
    return { phase: 'error', reason: 'timeout', message: null }
  }
  return { phase: 'running' }
}

/**
 * Next poll interval, or false to stop. Consistent with chatTurnView by
 * construction: keep polling exactly while the view is still "running". A
 * network blip therefore keeps polling (the turn survives it); only a 404 or
 * the budget ends it.
 */
export function chatPollInterval(snap: ChatPollSnapshot): number | false {
  return chatTurnView(snap).phase === 'running' ? CHAT_POLL_INTERVAL_MS : false
}
