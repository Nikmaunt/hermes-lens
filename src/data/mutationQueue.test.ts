import { describe, expect, it, vi } from 'vitest'
import type { DataSource } from './DataSource'
import { MemoryKV } from './kv'
import { createMutationQueue, type QueuedMutation } from './mutationQueue'

const captureItem = (n: number, source: 'mock' | 'api' = 'api'): QueuedMutation => ({
  id: `q${n}`,
  kind: 'capture',
  source,
  enqueuedAt: new Date().toISOString(),
  req: { text: `note ${n}`, tags: [] },
})

function fakeDataSource(capture: () => Promise<unknown>, kind: 'mock' | 'api' = 'api'): DataSource {
  return { kind, capture } as unknown as DataSource
}

describe('mutation queue', () => {
  it('drains in order and clears the queue', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))
    await queue.enqueue(captureItem(2))
    expect(await queue.count()).toBe(2)

    const seen: string[] = []
    const ds = fakeDataSource(vi.fn().mockImplementation((req: { text: string }) => {
      seen.push(req.text)
      return Promise.resolve({ status: 'ok' })
    }) as unknown as () => Promise<unknown>)

    expect(await queue.drain(ds)).toBe(2)
    expect(await queue.count()).toBe(0)
  })

  it('stops at the first failure and keeps the remainder', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))
    await queue.enqueue(captureItem(2))
    await queue.enqueue(captureItem(3))

    let calls = 0
    const ds = fakeDataSource(() => {
      calls++
      return calls === 2 ? Promise.reject(new Error('offline')) : Promise.resolve({})
    })

    expect(await queue.drain(ds)).toBe(1)
    expect(await queue.count()).toBe(2)
    const remaining = await queue.peek()
    expect(remaining[0]?.id).toBe('q2')
  })

  it('never replays api-bound mutations into the mock source', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1, 'api'))
    await queue.enqueue(captureItem(2, 'mock'))

    const mockCalls: string[] = []
    const mockDs = fakeDataSource((req?: unknown) => {
      mockCalls.push((req as { text: string }).text)
      return Promise.resolve({})
    }, 'mock')

    // Draining against the mock flushes only the mock-bound item…
    expect(await queue.drain(mockDs as DataSource)).toBe(1)
    expect(await queue.count()).toBe(1)
    expect((await queue.peek())[0]?.id).toBe('q1')

    // …and the api-bound one stays until an api source succeeds.
    const apiDs = fakeDataSource(() => Promise.resolve({}), 'api')
    expect(await queue.drain(apiDs)).toBe(1)
    expect(await queue.count()).toBe(0)
  })

  it('does not double-send items when drains overlap', async () => {
    // Regression: drain() had no serialization, so a second drain starting
    // while the first was mid-flight (fast resume + "Sync now") loaded the
    // same items and replayed them again — duplicate captures on the server.
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const capture = vi.fn(async () => {
      await gate
      return {}
    })
    const ds = fakeDataSource(capture as unknown as () => Promise<unknown>)

    const first = queue.drain(ds)
    const second = queue.drain(ds)
    release()
    const flushed = (await first) + (await second)

    expect(capture).toHaveBeenCalledTimes(1)
    expect(flushed).toBe(1)
    expect(await queue.count()).toBe(0)
  })

  it('does not lose a mutation enqueued while a drain is in flight', async () => {
    // Regression: drain() saved back its stale snapshot of the queue, wiping
    // any item enqueued after the drain had loaded but before it saved.
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const ds = fakeDataSource(async () => {
      await gate
      return {}
    })

    const draining = queue.drain(ds)
    await new Promise((resolve) => setTimeout(resolve, 0)) // let drain load the queue
    const enqueued = queue.enqueue(captureItem(2))
    release()
    await draining
    await enqueued

    // Item 2 was never sent, so it must still be queued.
    expect(await queue.count()).toBe(1)
    expect((await queue.peek())[0]?.id).toBe('q2')
  })

  it('notifies count listeners', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const counts: number[] = []
    queue.onCountChange((c) => counts.push(c))
    await queue.enqueue(captureItem(1))
    await queue.enqueue(captureItem(2))
    expect(counts).toEqual([1, 2])
  })
})
