import { describe, expect, it, vi } from 'vitest'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { NotificationCaptureRequest } from '@/schemas'
import type { BufferedNotification } from './notifBridge'
import { drainNotificationBuffer, stableClientId } from './notifDrain'

const buffered = (n: number, extra: Partial<BufferedNotification> = {}): BufferedNotification => ({
  id: `buf-${n}`,
  package: 'com.whatsapp',
  postedAt: '2026-07-11T09:30:00+02:00',
  capturedAt: '2026-07-11T09:30:02+02:00',
  title: `Sender ${n}`,
  text: `message ${n}`,
  ...extra,
})

function fakeBridge(items: BufferedNotification[]) {
  return {
    consumeBuffered: vi.fn(() => Promise.resolve({ items })),
    ackBuffered: vi.fn((_: { upToId: string }) => Promise.resolve()),
  }
}

describe('stableClientId', () => {
  it('is a pure function of the buffer id — identical across retries', () => {
    expect(stableClientId('buf-1')).toBe(stableClientId('buf-1'))
    expect(stableClientId('buf-1')).not.toBe(stableClientId('buf-2'))
  })

  it('is UUID-shaped and satisfies the schema minimum length', () => {
    const id = stableClientId('buf-1')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(id.length).toBeGreaterThanOrEqual(8)
  })
})

describe('drainNotificationBuffer', () => {
  it('moves N buffered items into the queue as notification mutations, then acks up to the last id', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const items = [buffered(1), buffered(2), buffered(3, { bigText: 'long form' })]
    const bridge = fakeBridge(items)

    const moved = await drainNotificationBuffer({ bridge, queue, source: 'api', enabled: true })

    expect(moved).toBe(3)
    const queued = await queue.peek()
    expect(queued).toHaveLength(3)
    for (const [i, mutation] of queued.entries()) {
      expect(mutation.kind).toBe('notification')
      expect(mutation.source).toBe('api')
      if (mutation.kind !== 'notification') continue
      // The enqueued payload must be a valid NotificationCaptureRequest.
      const req = NotificationCaptureRequest.parse(mutation.req)
      expect(req.package).toBe('com.whatsapp')
      expect(req.text).toBe(`message ${i + 1}`)
      expect(req.postedAt).toBe('2026-07-11T09:30:00+02:00')
      expect(req.clientId).toBe(stableClientId(`buf-${i + 1}`))
    }
    const third = queued[2]
    expect(third?.kind === 'notification' && third.req.bigText).toBe('long form')
    expect(bridge.ackBuffered).toHaveBeenCalledExactlyOnceWith({ upToId: 'buf-3' })
  })

  it('acks only AFTER every item is enqueued — the queue owns delivery, not the buffer', async () => {
    const order: string[] = []
    const queue = {
      enqueue: vi.fn(() => {
        order.push('enqueue')
        return Promise.resolve()
      }),
    }
    const bridge = fakeBridge([buffered(1), buffered(2)])
    bridge.ackBuffered.mockImplementation(() => {
      order.push('ack')
      return Promise.resolve()
    })

    await drainNotificationBuffer({ bridge, queue, source: 'api', enabled: true })

    expect(order).toEqual(['enqueue', 'enqueue', 'ack'])
  })

  it('mints the same clientIds when a drain retries the same buffer (ack failed / crashed)', async () => {
    const items = [buffered(1), buffered(2)]
    const firstQueue = createMutationQueue(new MemoryKV())
    const secondQueue = createMutationQueue(new MemoryKV())

    await drainNotificationBuffer({
      bridge: fakeBridge(items),
      queue: firstQueue,
      source: 'api',
      enabled: true,
    })
    await drainNotificationBuffer({
      bridge: fakeBridge(items),
      queue: secondQueue,
      source: 'api',
      enabled: true,
    })

    const clientIds = (queued: Awaited<ReturnType<typeof firstQueue.peek>>) =>
      queued.map((m) => (m.kind === 'notification' ? m.req.clientId : '?'))
    expect(clientIds(await firstQueue.peek())).toEqual(clientIds(await secondQueue.peek()))
  })

  it('never touches the plugin while the toggle is off', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const bridge = fakeBridge([buffered(1)])

    const moved = await drainNotificationBuffer({ bridge, queue, source: 'api', enabled: false })

    expect(moved).toBe(0)
    expect(bridge.consumeBuffered).not.toHaveBeenCalled()
    expect(await queue.count()).toBe(0)
  })

  it('fails open when the plugin is unavailable (browser mock must not shout)', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const bridge = {
      consumeBuffered: vi.fn(() => Promise.reject(new Error('not implemented on web'))),
      ackBuffered: vi.fn(() => Promise.resolve()),
    }

    await expect(
      drainNotificationBuffer({ bridge, queue, source: 'api', enabled: true }),
    ).resolves.toBe(0)
    expect(await queue.count()).toBe(0)
    expect(bridge.ackBuffered).not.toHaveBeenCalled()
  })

  it('keeps the enqueued mutations when only the ack fails — replays dedup by clientId', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const bridge = fakeBridge([buffered(1)])
    bridge.ackBuffered.mockImplementation(() => Promise.reject(new Error('service died')))

    await expect(
      drainNotificationBuffer({ bridge, queue, source: 'api', enabled: true }),
    ).resolves.toBe(1)
    expect(await queue.count()).toBe(1)
  })

  it('serializes overlapping drains — two rapid foregrounds must not enqueue duplicates', async () => {
    // Both drains used to consume the same un-acked buffer entries before
    // either acked, enqueueing every notification twice (the server dedups
    // by clientId, but the queue still replayed doubled sends).
    const queue = createMutationQueue(new MemoryKV())
    let pending = [buffered(1), buffered(2)]
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let firstConsume = true
    const bridge = {
      consumeBuffered: vi.fn(async () => {
        // Snapshot first, then stall: models the native read finishing while
        // the transport back to the WebView is still in flight.
        const items = [...pending]
        if (firstConsume) {
          firstConsume = false
          await gate
        }
        return { items }
      }),
      ackBuffered: vi.fn(({ upToId }: { upToId: string }) => {
        const idx = pending.findIndex((item) => item.id === upToId)
        if (idx !== -1) pending = pending.slice(idx + 1)
        return Promise.resolve()
      }),
    }

    const first = drainNotificationBuffer({ bridge, queue, source: 'api', enabled: true })
    const second = drainNotificationBuffer({ bridge, queue, source: 'api', enabled: true })
    release()

    expect(await first).toBe(2)
    expect(await second).toBe(0) // the buffer was consumed and acked by the first drain
    expect(await queue.count()).toBe(2) // each notification enqueued exactly once
  })

  it('does not ack an empty buffer', async () => {
    const queue = createMutationQueue(new MemoryKV())
    const bridge = fakeBridge([])

    expect(await drainNotificationBuffer({ bridge, queue, source: 'api', enabled: true })).toBe(0)
    expect(bridge.ackBuffered).not.toHaveBeenCalled()
  })
})
