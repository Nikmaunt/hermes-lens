import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './ApiDataSource'
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

  it('moves permanently rejected items to the dead-letter list and keeps draining (F5 wedge)', async () => {
    // Reproduces the wedge: a single 400 at the head of the queue used to
    // block every mutation behind it forever, because drain() treated all
    // failures as "still offline".
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))
    await queue.enqueue(captureItem(2))
    await queue.enqueue(captureItem(3))

    let call = 0
    const ds = fakeDataSource(() => {
      call++
      return call === 1
        ? Promise.reject(new ApiError('Agent returned 400', 'server', 400))
        : Promise.resolve({})
    })

    expect(await queue.drain(ds)).toBe(2) // q2 and q3 must flush past the poisoned q1
    expect(await queue.count()).toBe(0)

    const dead = await queue.deadLetters()
    expect(dead.map((d) => d.item.id)).toEqual(['q1'])
    expect(dead[0]?.status).toBe(400)
  })

  it('treats 408 and 429 as transient, preserving order', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))
    await queue.enqueue(captureItem(2))

    let call = 0
    const ds = fakeDataSource(() => {
      call++
      return call === 1
        ? Promise.reject(new ApiError('Agent returned 429', 'server', 429))
        : Promise.resolve({})
    })

    expect(await queue.drain(ds)).toBe(0) // transient head blocks the rest — order preserved
    expect(await queue.count()).toBe(2)
    expect(await queue.deadLetters()).toEqual([])
    expect((await queue.peek())[0]?.id).toBe('q1')
  })

  it('keeps network failures and 5xx out of the dead-letter list', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))
    const ds = fakeDataSource(() => Promise.reject(new ApiError('Agent returned 503', 'server', 503)))
    expect(await queue.drain(ds)).toBe(0)
    expect(await queue.count()).toBe(1)
    expect(await queue.deadLetters()).toEqual([])
  })

  it('retryDeadLetter moves the item back into the live queue', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))
    const rejecting = fakeDataSource(() =>
      Promise.reject(new ApiError('Agent returned 422', 'server', 422)),
    )
    await queue.drain(rejecting)
    expect(await queue.count()).toBe(0)
    expect((await queue.deadLetters()).length).toBe(1)

    await queue.retryDeadLetter('q1')
    expect(await queue.deadLetters()).toEqual([])
    expect(await queue.count()).toBe(1)

    const accepting = fakeDataSource(() => Promise.resolve({}))
    expect(await queue.drain(accepting)).toBe(1)
    expect(await queue.count()).toBe(0)
  })

  it('discardDeadLetter drops the item for good', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(captureItem(1))
    await queue.drain(
      fakeDataSource(() => Promise.reject(new ApiError('Agent returned 400', 'server', 400))),
    )
    await queue.discardDeadLetter('q1')
    expect(await queue.deadLetters()).toEqual([])
    expect(await queue.count()).toBe(0)
  })

  it('notifies dead-letter listeners', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const counts: number[] = []
    queue.onDeadLetterChange((c) => counts.push(c))
    await queue.enqueue(captureItem(1))
    await queue.drain(
      fakeDataSource(() => Promise.reject(new ApiError('Agent returned 400', 'server', 400))),
    )
    await queue.discardDeadLetter('q1')
    expect(counts).toEqual([1, 0])
  })

  it('replays followup actions in order and treats a 200 {status:"gone"} as success', async () => {
    // "gone" means the agent already resolved the item — success-by-staleness,
    // the mutation must leave the queue without any dead-lettering.
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue({
      id: 'f1',
      kind: 'followup-action',
      source: 'api',
      enqueuedAt: new Date().toISOString(),
      itemId: 'fu-1',
      req: { action: 'done' },
    })
    await queue.enqueue({
      id: 'f2',
      kind: 'followup-action',
      source: 'api',
      enqueuedAt: new Date().toISOString(),
      itemId: 'fu-2',
      req: { action: 'snooze', until: '2026-07-13' },
    })

    const seen: { itemId: string; action: string }[] = []
    const ds = {
      kind: 'api',
      followupAction: (itemId: string, req: { action: string }) => {
        seen.push({ itemId, action: req.action })
        return Promise.resolve({ status: 'gone', itemId })
      },
    } as unknown as DataSource

    expect(await queue.drain(ds)).toBe(2)
    expect(await queue.count()).toBe(0)
    expect(await queue.deadLetters()).toEqual([])
    expect(seen).toEqual([
      { itemId: 'fu-1', action: 'done' },
      { itemId: 'fu-2', action: 'snooze' },
    ])
  })

  it('keeps a followup action queued in order across a transient failure', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue({
      id: 'f1',
      kind: 'followup-action',
      source: 'api',
      enqueuedAt: new Date().toISOString(),
      itemId: 'fu-1',
      req: { action: 'snooze', until: '2026-07-06' },
    })

    const offline = {
      kind: 'api',
      followupAction: () => Promise.reject(new ApiError('Agent timed out', 'timeout')),
    } as unknown as DataSource
    expect(await queue.drain(offline)).toBe(0)
    expect(await queue.count()).toBe(1)
    expect(await queue.deadLetters()).toEqual([])

    // Back online: the same request replays with its original payload.
    const sent: unknown[] = []
    const online = {
      kind: 'api',
      followupAction: (itemId: string, req: unknown) => {
        sent.push({ itemId, req })
        return Promise.resolve({ status: 'ok', itemId })
      },
    } as unknown as DataSource
    expect(await queue.drain(online)).toBe(1)
    expect(sent).toEqual([{ itemId: 'fu-1', req: { action: 'snooze', until: '2026-07-06' } }])
  })

  it('replays habit ticks and treats gone as success', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue({
      id: 'h1',
      kind: 'habit-tick',
      source: 'api',
      enqueuedAt: new Date().toISOString(),
      itemId: 'habit-gym',
      req: { date: '2026-07-05' },
    })

    const ds = {
      kind: 'api',
      tickHabit: (itemId: string) => Promise.resolve({ status: 'gone', itemId }),
    } as unknown as DataSource
    expect(await queue.drain(ds)).toBe(1)
    expect(await queue.count()).toBe(0)
    expect(await queue.deadLetters()).toEqual([])
  })

  it('remove withdraws a still-queued mutation and notifies listeners', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const counts: number[] = []
    queue.onCountChange((c) => counts.push(c))
    await queue.enqueue(captureItem(1))
    await queue.enqueue(captureItem(2))

    expect(await queue.remove('q1')).toBe(true)
    expect(await queue.count()).toBe(1)
    expect((await queue.peek())[0]?.id).toBe('q2')
    expect(counts).toEqual([1, 2, 1])

    // Already gone (e.g. a drain raced the undo): nothing to withdraw.
    expect(await queue.remove('q1')).toBe(false)
    expect(await queue.count()).toBe(1)
  })

  it('replays undo mutations to the matching DataSource methods', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const enqueuedAt = new Date().toISOString()
    await queue.enqueue({ id: 'u1', kind: 'followup-undo', source: 'api', enqueuedAt, itemId: 'fu-1' })
    await queue.enqueue({
      id: 'u2',
      kind: 'habit-undo',
      source: 'api',
      enqueuedAt,
      itemId: 'habit-gym',
      req: { date: '2026-07-05' },
    })
    await queue.enqueue({ id: 'u3', kind: 'untriage', source: 'api', enqueuedAt, itemId: 'in-1' })

    const calls: unknown[] = []
    const ds = {
      kind: 'api',
      undoFollowupAction: (itemId: string) => {
        calls.push(['followup-undo', itemId])
        return Promise.resolve({ status: 'ok', itemId })
      },
      undoHabitTick: (itemId: string, req: unknown) => {
        calls.push(['habit-undo', itemId, req])
        // gone is success-by-staleness for undo too: the agent already
        // processed the original action, nothing to keep in the queue.
        return Promise.resolve({ status: 'gone', itemId })
      },
      untriage: (itemId: string) => {
        calls.push(['untriage', itemId])
        return Promise.resolve({ status: 'ok', itemId })
      },
    } as unknown as DataSource

    expect(await queue.drain(ds)).toBe(3)
    expect(await queue.count()).toBe(0)
    expect(await queue.deadLetters()).toEqual([])
    expect(calls).toEqual([
      ['followup-undo', 'fu-1'],
      ['habit-undo', 'habit-gym', { date: '2026-07-05' }],
      ['untriage', 'in-1'],
    ])
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
