import type { CaptureRequest, FlagRequest, TriageRequest } from '@/schemas'
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

const KEY = 'mutation-queue'

/**
 * Offline write queue. Capture/triage/flag actions that fail (no network,
 * VPS down) land here and are retried when the app returns to the foreground
 * or the user refreshes. Order is preserved.
 */
export function createMutationQueue(kv: KV) {
  const listeners = new Set<(count: number) => void>()

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

  async function load(): Promise<QueuedMutation[]> {
    const raw = await kv.get(KEY)
    if (raw === null) return []
    try {
      return JSON.parse(raw) as QueuedMutation[]
    } catch {
      return []
    }
  }

  async function save(items: QueuedMutation[]): Promise<void> {
    await kv.set(KEY, JSON.stringify(items))
    for (const fn of listeners) fn(items.length)
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

    /**
     * Replay queued mutations that belong to `ds` (same source kind), in
     * order. Stops at the first failure (assumed to still be offline) and
     * keeps the remainder queued; mutations for the other source are always
     * kept untouched. Returns how many were flushed.
     */
    drain(ds: DataSource): Promise<number> {
      return serialized(async () => {
        const items = await load()
        const kept: QueuedMutation[] = []
        let flushed = 0
        let failed = false
        for (const item of items) {
          if (item.source !== ds.kind || failed) {
            kept.push(item)
            continue
          }
          try {
            if (item.kind === 'capture') await ds.capture(item.req)
            else if (item.kind === 'triage') await ds.triage(item.itemId, item.req)
            else await ds.flagMemory(item.itemId, item.req)
            flushed++
          } catch {
            failed = true
            kept.push(item)
          }
        }
        if (flushed > 0) await save(kept)
        return flushed
      })
    },

    onCountChange(fn: (count: number) => void): () => void {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export type MutationQueue = ReturnType<typeof createMutationQueue>
