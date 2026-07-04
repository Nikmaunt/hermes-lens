import type { CaptureRequest, FlagRequest, SyncAckRequest, TriageRequest } from '@/schemas'
import type { DataSource } from './DataSource'
import type { KV } from './kv'

/** Which data source the mutation was made against — it must only ever be
 * replayed to the same one (an action meant for the agent must not be
 * swallowed by the mock after a settings switch). */
type Source = 'mock' | 'api'

export type QueuedMutation =
  | { id: string; kind: 'capture'; source: Source; enqueuedAt: string; req: CaptureRequest }
  | { id: string; kind: 'triage'; source: Source; enqueuedAt: string; itemId: string; req: TriageRequest }
  | { id: string; kind: 'flag'; source: Source; enqueuedAt: string; itemId: string; req: FlagRequest }
  | { id: string; kind: 'ack-sync'; source: Source; enqueuedAt: string; req: SyncAckRequest }

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
 * A 4xx (except 408 Request Timeout and 429 Too Many Requests) means the
 * server understood the request and said no — retrying the same bytes will
 * never succeed, so the item must not block the queue (F5). Everything else
 * (network failure, timeout, 5xx, 408/429) is assumed transient.
 */
function permanentStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const status = (err as { status?: unknown }).status
  if (typeof status !== 'number') return null
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? status : null
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
    if (item.kind === 'capture') await ds.capture(item.req)
    else if (item.kind === 'triage') await ds.triage(item.itemId, item.req)
    else if (item.kind === 'flag') await ds.flagMemory(item.itemId, item.req)
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
     * order. A transient failure (offline, 5xx, timeout) stops the replay
     * and keeps the remainder queued in order; a permanent rejection (other
     * 4xx) moves that item to the dead-letter list and the drain continues.
     * Mutations for the other source are always kept untouched. Returns how
     * many were flushed.
     */
    drain(ds: DataSource): Promise<number> {
      return serialized(async () => {
        const items = await load()
        const kept: QueuedMutation[] = []
        const dead: DeadLetter[] = []
        let flushed = 0
        let blocked = false
        for (const item of items) {
          if (item.source !== ds.kind || blocked) {
            kept.push(item)
            continue
          }
          try {
            await send(ds, item)
            flushed++
          } catch (err) {
            const status = permanentStatus(err)
            if (status !== null) {
              dead.push({
                item,
                failedAt: new Date().toISOString(),
                status,
                reason: err instanceof Error ? err.message : `Rejected with ${status}`,
              })
            } else {
              blocked = true
              kept.push(item)
            }
          }
        }
        if (flushed > 0 || dead.length > 0) await save(kept)
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
