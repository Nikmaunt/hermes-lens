import type {
  CaptureRequest,
  CommandRequest,
  FlagRequest,
  FollowupActionRequest,
  HabitTickRequest,
  NotificationCaptureRequest,
  SomedayActionRequest,
  SyncAckRequest,
  TriageRequest,
} from '@/schemas'
import type { DataSource } from './DataSource'
import type { KV } from './kv'

/** Which data source the mutation was made against — it must only ever be
 * replayed to the same one (an action meant for the agent must not be
 * swallowed by the mock after a settings switch). */
type Source = 'mock' | 'api'

type QueuedMutationBody =
  | { id: string; kind: 'capture'; source: Source; enqueuedAt: string; req: CaptureRequest }
  | { id: string; kind: 'triage'; source: Source; enqueuedAt: string; itemId: string; req: TriageRequest }
  | { id: string; kind: 'flag'; source: Source; enqueuedAt: string; itemId: string; req: FlagRequest }
  | { id: string; kind: 'followup-action'; source: Source; enqueuedAt: string; itemId: string; req: FollowupActionRequest }
  | { id: string; kind: 'habit-tick'; source: Source; enqueuedAt: string; itemId: string; req: HabitTickRequest }
  | { id: string; kind: 'ack-sync'; source: Source; enqueuedAt: string; req: SyncAckRequest }
  | { id: string; kind: 'followup-undo'; source: Source; enqueuedAt: string; itemId: string }
  | { id: string; kind: 'habit-undo'; source: Source; enqueuedAt: string; itemId: string; req: HabitTickRequest }
  | { id: string; kind: 'untriage'; source: Source; enqueuedAt: string; itemId: string }
  | { id: string; kind: 'someday-action'; source: Source; enqueuedAt: string; itemId: string; req: Exclude<SomedayActionRequest, { action: 'undo' }> }
  | { id: string; kind: 'someday-undo'; source: Source; enqueuedAt: string; itemId: string }
  | { id: string; kind: 'notification'; source: Source; enqueuedAt: string; req: NotificationCaptureRequest }
  | { id: string; kind: 'command'; source: Source; enqueuedAt: string; req: CommandRequest }

export type QueuedMutation = QueuedMutationBody & {
  /** Failed drains due to unclassifiable errors only (see drain); absent
   * until the first such failure. */
  attempts?: number
}

/** A mutation the server permanently rejected — parked for the user to decide. */
export interface DeadLetter {
  item: QueuedMutation
  failedAt: string
  status: number | null
  reason: string
}

const KEY = 'mutation-queue'
const DEAD_KEY = 'mutation-dead-letter'

/**
 * An unclassifiable error (no HTTP status, not a recognized transport kind —
 * e.g. a TypeError thrown by a bug) is retried this many drains before the
 * item is parked as a dead letter: it is almost certainly deterministic and
 * must not wedge the queue forever.
 */
const MAX_UNCLASSIFIED_ATTEMPTS = 5

function httpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const status = (err as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

/**
 * A 4xx means the server understood the request and said no — retrying the
 * same bytes will never succeed, so the item must not block the queue (F5).
 * Exceptions, all transient: 408 Request Timeout, 429 Too Many Requests,
 * and 401/403 — those reject the TOKEN, not the payload; once the user
 * fixes it (AuthBanner says why) the same bytes will succeed. Everything
 * else (network failure, timeout, 5xx) is assumed transient too.
 */
const TRANSIENT_4XX = new Set([401, 403, 408, 429])
function permanentStatus(err: unknown): number | null {
  const status = httpStatus(err)
  if (status === null) return null
  return status >= 400 && status < 500 && !TRANSIENT_4XX.has(status) ? status : null
}

/** ApiError kinds that describe weather, not bugs — worth blocking the
 * queue for, in order, until the network/agent recovers. */
const TRANSIENT_KINDS = new Set(['timeout', 'network', 'auth', 'server'])

function errorKind(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const kind = (err as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : null
}

/**
 * Offline write queue. Capture/triage/flag actions that fail (no network,
 * VPS down) land here and are retried when the app returns to the foreground
 * or the user refreshes. Order is preserved for transient failures;
 * permanently rejected items move to a dead-letter list surfaced in Settings.
 */
export function createMutationQueue(kv: KV) {
  const listeners = new Set<(count: number) => void>()
  const deadListeners = new Set<(count: number) => void>()

  // All read-modify-write operations run one at a time: an overlapping pair
  // of drains would replay the same items twice (captures are not
  // idempotent), and an enqueue racing a drain could be wiped when the drain
  // saved back its stale snapshot of the queue.
  let chain: Promise<unknown> = Promise.resolve()
  function serialized<T>(op: () => Promise<T>): Promise<T> {
    const result = chain.then(op, op)
    chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function loadList<T>(key: string): Promise<T[]> {
    const raw = await kv.get(key)
    if (raw === null) return []
    try {
      return JSON.parse(raw) as T[]
    } catch {
      return []
    }
  }

  const load = () => loadList<QueuedMutation>(KEY)
  const loadDead = () => loadList<DeadLetter>(DEAD_KEY)

  async function save(items: QueuedMutation[]): Promise<void> {
    await kv.set(KEY, JSON.stringify(items))
    for (const fn of listeners) fn(items.length)
  }

  async function saveDead(items: DeadLetter[]): Promise<void> {
    await kv.set(DEAD_KEY, JSON.stringify(items))
    for (const fn of deadListeners) fn(items.length)
  }

  async function send(ds: DataSource, item: QueuedMutation): Promise<void> {
    // A 200 {status:'gone'} resolves normally — success-by-staleness, the
    // agent already dealt with the item; only thrown errors keep or park it.
    if (item.kind === 'capture') await ds.capture(item.req)
    else if (item.kind === 'triage') await ds.triage(item.itemId, item.req)
    else if (item.kind === 'flag') await ds.flagMemory(item.itemId, item.req)
    else if (item.kind === 'followup-action') await ds.followupAction(item.itemId, item.req)
    else if (item.kind === 'habit-tick') await ds.tickHabit(item.itemId, item.req)
    else if (item.kind === 'followup-undo') await ds.undoFollowupAction(item.itemId)
    else if (item.kind === 'habit-undo') await ds.undoHabitTick(item.itemId, item.req)
    else if (item.kind === 'untriage') await ds.untriage(item.itemId)
    else if (item.kind === 'someday-action') await ds.somedayAction(item.itemId, item.req)
    else if (item.kind === 'someday-undo') await ds.somedayAction(item.itemId, { action: 'undo' })
    // A 200 {status:'duplicate'} resolves normally — the server already has
    // this notification (replay deduped by clientId), which is success here.
    else if (item.kind === 'notification') await ds.captureNotification(item.req)
    // Same duplicate-is-success contract: the sidecar's command ledger dedups
    // replays by clientId. Its 429 (20 commands/hour, in-memory window) stays
    // transient via TRANSIENT_4XX — the command is redelivered next drain.
    else if (item.kind === 'command') await ds.postCommand(item.req)
    else await ds.ackSync(item.req)
  }

  return {
    enqueue(item: QueuedMutation): Promise<void> {
      return serialized(async () => {
        const items = await load()
        items.push(item)
        await save(items)
      })
    },

    /**
     * Withdraw a mutation that is still waiting in the queue (undo before
     * anything was sent). Returns false when it is no longer there — a drain
     * raced the undo and already sent it, so the caller must undo over the
     * network instead.
     */
    remove(id: string): Promise<boolean> {
      return serialized(async () => {
        const items = await load()
        const kept = items.filter((item) => item.id !== id)
        if (kept.length === items.length) return false
        await save(kept)
        return true
      })
    },

    async count(): Promise<number> {
      return (await load()).length
    },

    async peek(): Promise<QueuedMutation[]> {
      return load()
    },

    async deadLetters(): Promise<DeadLetter[]> {
      return loadDead()
    },

    /**
     * Replay queued mutations that belong to `ds` (same source kind), in
     * order. A transient failure (offline, 5xx, timeout, auth) stops the
     * replay and keeps the remainder queued in order; a permanent rejection
     * (other 4xx, or an invalid-response error — the server accepted the
     * write, only the reply failed validation) moves that item to the
     * dead-letter list and the drain continues. An unclassifiable error
     * (no status, no known kind) never blocks the tail: the item stays in
     * place with an attempt counter and parks after
     * MAX_UNCLASSIFIED_ATTEMPTS failed drains. Mutations for the other
     * source are always kept untouched. Returns how many were flushed.
     */
    drain(ds: DataSource): Promise<number> {
      return serialized(async () => {
        const items = await load()
        const kept: QueuedMutation[] = []
        const dead: DeadLetter[] = []
        let flushed = 0
        let blocked = false
        let counted = false
        // Kinds rate-limited (429) in THIS drain: skipped in place so a
        // server-side per-hour cap on the notification mirror cannot park
        // the user's own mutations queued behind it.
        const rateLimited = new Set<QueuedMutation['kind']>()
        for (const item of items) {
          if (item.source !== ds.kind || blocked || rateLimited.has(item.kind)) {
            kept.push(item)
            continue
          }
          try {
            await send(ds, item)
            flushed++
          } catch (err) {
            const failedAt = new Date().toISOString()
            const status = permanentStatus(err)
            const kind = errorKind(err)
            const reason = err instanceof Error ? err.message : `Rejected with ${status ?? '?'}`
            if (status !== null) {
              dead.push({ item, failedAt, status, reason })
            } else if (kind === 'invalid') {
              // The server ACCEPTED this write — only its response failed
              // schema validation. Retrying resends bytes the server already
              // has, so this is a permanent outcome, never a queue blocker.
              dead.push({ item, failedAt, status: null, reason })
            } else if ((kind !== null && TRANSIENT_KINDS.has(kind)) || httpStatus(err) !== null) {
              if (httpStatus(err) === 429 && item.kind === 'notification') {
                rateLimited.add(item.kind)
                kept.push(item)
              } else {
                blocked = true
                kept.push(item)
              }
            } else {
              const attempts = (item.attempts ?? 0) + 1
              if (attempts >= MAX_UNCLASSIFIED_ATTEMPTS) {
                dead.push({ item, failedAt, status: null, reason })
              } else {
                counted = true
                kept.push({ ...item, attempts })
              }
            }
          }
        }
        if (flushed > 0 || dead.length > 0 || counted) await save(kept)
        if (dead.length > 0) await saveDead([...(await loadDead()), ...dead])
        return flushed
      })
    },

    /** Move a dead letter back to the end of the live queue for another try. */
    retryDeadLetter(id: string): Promise<void> {
      return serialized(async () => {
        const dead = await loadDead()
        const entry = dead.find((d) => d.item.id === id)
        if (entry === undefined) return
        await saveDead(dead.filter((d) => d.item.id !== id))
        const items = await load()
        items.push(entry.item)
        await save(items)
      })
    },

    /** Drop a dead letter permanently (user gave up on it). */
    discardDeadLetter(id: string): Promise<void> {
      return serialized(async () => {
        const dead = await loadDead()
        await saveDead(dead.filter((d) => d.item.id !== id))
      })
    },

    onCountChange(fn: (count: number) => void): () => void {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    onDeadLetterChange(fn: (count: number) => void): () => void {
      deadListeners.add(fn)
      return () => deadListeners.delete(fn)
    },
  }
}

export type MutationQueue = ReturnType<typeof createMutationQueue>
