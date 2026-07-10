import { registerPlugin } from '@capacitor/core'

/**
 * One captured notification held in the native listener's ring buffer.
 * `id` is the buffer entry's stable identity: it survives app restarts and
 * repeated consumeBuffered() calls until the entry is acked away, so the web
 * layer derives the dedup clientId from it (see notifDrain.stableClientId).
 */
export interface BufferedNotification {
  id: string
  package: string
  /** ISO8601 — when the app posted the notification. */
  postedAt: string
  /** ISO8601 — when the listener service captured it. */
  capturedAt: string
  title: string
  text: string
  bigText?: string
}

/**
 * Bridge to the native notification-listener service. This interface is the
 * frozen contract the Java implementation (NotifBridgePlugin.java) satisfies;
 * on Android the registered native plugin answers, while the web fallback
 * below keeps the whole layer exercisable in the browser and in vitest.
 */
export interface NotifBridgePlugin {
  /**
   * Read everything the buffer holds, oldest first, WITHOUT removing it —
   * entries leave the buffer only via ackBuffered, after the web layer has
   * safely enqueued them.
   */
  consumeBuffered(): Promise<{ items: BufferedNotification[] }>
  /** Drop buffer entries up to and including `upToId`. */
  ackBuffered(options: { upToId: string }): Promise<void>
  /** Whether the OS-level notification-listener access is granted to the app. */
  isServiceEnabled(): Promise<{ enabled: boolean }>
  /** Open the system "notification access" settings screen. */
  openSystemSettings(): Promise<void>
}

/** Browser/dev fallback: no native service — an always-empty, always-quiet buffer. */
const webNotifBridge: NotifBridgePlugin = {
  consumeBuffered: () => Promise.resolve({ items: [] }),
  ackBuffered: () => Promise.resolve(),
  isServiceEnabled: () => Promise.resolve({ enabled: false }),
  openSystemSettings: () => Promise.resolve(),
}

export const NotifBridge = registerPlugin<NotifBridgePlugin>('NotifBridge', {
  web: webNotifBridge,
})
