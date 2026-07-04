import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/**
 * Bridge to ShareBridgePlugin.java: receives text shared into the app via
 * the Android share sheet (ACTION_SEND). Cold starts are pulled once via
 * consumePendingShare; warm starts arrive as "share" events.
 */
interface ShareBridgePlugin {
  consumePendingShare(): Promise<{ text: string | null }>
  addListener(
    eventName: 'share',
    listener: (data: { text: string }) => void,
  ): Promise<PluginListenerHandle>
}

const ShareBridge = registerPlugin<ShareBridgePlugin>('ShareBridge')

/**
 * Subscribe to incoming shares. Returns an unsubscribe function. No-op in
 * the browser (the plugin only exists on Android).
 */
export function onSharedText(deliver: (text: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined

  const handle = (text: string | null | undefined) => {
    if (typeof text === 'string' && text.trim() !== '') deliver(text)
  }

  ShareBridge.consumePendingShare()
    .then(({ text }) => handle(text))
    .catch(() => {
      // Plugin missing (old APK) — shares just don't arrive; nothing to break.
    })
  const sub = ShareBridge.addListener('share', ({ text }) => handle(text))
  return () => {
    void sub.then((s) => s.remove())
  }
}
