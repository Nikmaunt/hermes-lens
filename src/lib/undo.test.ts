import { describe, expect, it, vi } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue, type QueuedMutation } from '@/data/mutationQueue'
import { undoAction } from './undo'

const queuedTick = (id: string): QueuedMutation => ({
  id,
  kind: 'habit-tick',
  source: 'api',
  enqueuedAt: new Date().toISOString(),
  itemId: 'habit-gym',
  req: { date: '2026-07-05' },
})

describe('undoAction', () => {
  it('withdraws a still-queued mutation without touching the network', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(queuedTick('q1'))
    const sendUndo = vi.fn(() => Promise.resolve({ gone: false }))

    const outcome = await undoAction(queue, 'q1', sendUndo)

    expect(outcome).toEqual({ dequeued: true, gone: false })
    expect(sendUndo).not.toHaveBeenCalled()
    expect(await queue.count()).toBe(0)
  })

  it('sends the undo over the network when nothing is queued', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const sendUndo = vi.fn(() => Promise.resolve({ gone: true }))

    const outcome = await undoAction(queue, undefined, sendUndo)

    expect(outcome).toEqual({ dequeued: false, gone: true })
    expect(sendUndo).toHaveBeenCalledTimes(1)
  })

  it('falls back to the network when a drain already sent the mutation', async () => {
    // The queued id is stale: a drain raced the undo tap and flushed it.
    const queue = createMutationQueue(new MemoryKV())
    const sendUndo = vi.fn(() => Promise.resolve({ gone: false }))

    const outcome = await undoAction(queue, 'already-drained', sendUndo)

    expect(outcome).toEqual({ dequeued: false, gone: false })
    expect(sendUndo).toHaveBeenCalledTimes(1)
  })
})
