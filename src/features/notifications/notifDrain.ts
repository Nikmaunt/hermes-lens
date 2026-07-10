import type { MutationQueue } from '@/data/mutationQueue'
import type { NotificationCaptureRequest } from '@/schemas'
import type { BufferedNotification, NotifBridgePlugin } from './notifBridge'

/**
 * Deterministic UUID-shaped clientId derived from the buffer entry id. A
 * drain that crashed between enqueue and ack replays the same buffer entries
 * on the next foreground, and the server dedups those replays only if the
 * clientId is identical — so it must be a pure function of the buffer id,
 * never a fresh uuid per attempt.
 */
export function stableClientId(bufferId: string): string {
  // FNV-1a over the id with four different seeds → 128 bits, UUID-formatted.
  const hash = (seed: number): number => {
    let h = seed >>> 0
    for (let i = 0; i < bufferId.length; i++) {
      h ^= bufferId.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return h >>> 0
  }
  const hex = [hash(0x811c9dc5), hash(0x01000193), hash(0xdeadbeef), hash(0xcafebabe)]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function toCaptureRequest(item: BufferedNotification): NotificationCaptureRequest {
  return {
    clientId: stableClientId(item.id),
    package: item.package,
    postedAt: item.postedAt,
    capturedAt: item.capturedAt,
    title: item.title,
    text: item.text,
    ...(item.bigText === undefined ? {} : { bigText: item.bigText }),
  }
}

/**
 * Move everything the native buffer holds into the offline mutation queue.
 * Runs next to the queue drain (foreground/mount) and returns how many items
 * it moved, so the caller knows a queue drain is worth it.
 *
 * The buffer is acked after the ENQUEUE, not after the POST: once an item is
 * in the mutation queue, delivery is the queue's guarantee (retries, dead
 * letters), and keeping it buffered as well could only produce duplicates.
 * If the ack itself fails, the next drain replays the same entries and the
 * stable clientId makes that replay a server-side no-op.
 *
 * Plugin failures are swallowed (fail-open): the browser mock and a device
 * without the native service must never surface errors to the user.
 */
export async function drainNotificationBuffer(opts: {
  bridge: Pick<NotifBridgePlugin, 'consumeBuffered' | 'ackBuffered'>
  queue: Pick<MutationQueue, 'enqueue'>
  source: 'mock' | 'api'
  /** Settings toggle — when off, the plugin is never even called. */
  enabled: boolean
}): Promise<number> {
  const { bridge, queue, source, enabled } = opts
  if (!enabled) return 0

  let items: BufferedNotification[]
  try {
    ;({ items } = await bridge.consumeBuffered())
  } catch {
    return 0
  }
  const last = items[items.length - 1]
  if (last === undefined) return 0

  for (const item of items) {
    await queue.enqueue({
      id: crypto.randomUUID(),
      kind: 'notification',
      source,
      enqueuedAt: new Date().toISOString(),
      req: toCaptureRequest(item),
    })
  }
  try {
    await bridge.ackBuffered({ upToId: last.id })
  } catch {
    // Ack failed → the entries stay buffered and replay next drain; the
    // stable clientId turns that replay into 'duplicate' responses.
  }
  return items.length
}
