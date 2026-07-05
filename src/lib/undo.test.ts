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

const matchGymTick = (m: QueuedMutation): boolean =>
  m.kind === 'habit-tick' && m.itemId === 'habit-gym'

describe('undoAction', () => {
  it('withdraws a still-queued mutation without touching the network', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(queuedTick('q1'))
    const sendUndo = vi.fn(() => Promise.resolve({ gone: false }))

    const outcome = await undoAction(queue, matchGymTick, sendUndo)

    expect(outcome).toEqual({ dequeued: true, gone: false })
    expect(sendUndo).not.toHaveBeenCalled()
    expect(await queue.count()).toBe(0)
  })

  it('resolves the queue at undo time, not at closure-creation time', async () => {
    // The snackbar's onAction closure is created before the offline path
    // enqueues the mutation. The lookup must therefore happen inside
    // undoAction (queue.peek at tap time), or the withdrawal is missed.
    const queue = createMutationQueue(new MemoryKV())
    const sendUndo = vi.fn(() => Promise.resolve({ gone: false }))
    const tapUndo = () => undoAction(queue, matchGymTick, sendUndo)

    await queue.enqueue(queuedTick('late')) // enqueued after the closure

    expect(await tapUndo()).toEqual({ dequeued: true, gone: false })
    expect(sendUndo).not.toHaveBeenCalled()
    expect(await queue.count()).toBe(0)
  })

  it('sends the undo over the network when nothing matches', async () => {
    const queue = createMutationQueue(new MemoryKV())
    await queue.enqueue(queuedTick('other-item'))
    const sendUndo = vi.fn(() => Promise.resolve({ gone: true }))

    const outcome = await undoAction(
      queue,
      (m) => m.kind === 'habit-tick' && m.itemId === 'habit-spanish',
      sendUndo,
    )

    expect(outcome).toEqual({ dequeued: false, gone: true })
    expect(sendUndo).toHaveBeenCalledTimes(1)
    expect(await queue.count()).toBe(1) // the unrelated mutation stays
  })

  it('falls back to the network when a drain already sent the mutation', async () => {
    // Nothing in the queue: a drain raced the undo tap and flushed it.
    const queue = createMutationQueue(new MemoryKV())
    const sendUndo = vi.fn(() => Promise.resolve({ gone: false }))

    const outcome = await undoAction(queue, matchGymTick, sendUndo)

    expect(outcome).toEqual({ dequeued: false, gone: false })
    expect(sendUndo).toHaveBeenCalledTimes(1)
  })
})
