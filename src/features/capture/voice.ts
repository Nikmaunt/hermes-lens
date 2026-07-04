import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'

export type VoiceState = 'unavailable' | 'idle' | 'starting' | 'listening'

interface VoiceListenerHandle {
  remove: () => Promise<void> | void
}

interface PartialResultsEvent {
  matches?: string[]
  accumulatedText?: string
}

interface ListeningStateEvent {
  state?: string
  status?: string
  reason?: string
  errorCode?: string
}

interface ErrorEvent {
  code?: string
  message?: string
}

/** The slice of the plugin API the hook uses — injectable so tests can drive the state machine. */
export interface VoicePluginLike {
  available(): Promise<{ available: boolean }>
  requestPermissions(): Promise<{ speechRecognition: string }>
  start(options: { partialResults: boolean; maxResults: number }): Promise<unknown>
  stop(): Promise<void>
  addListener(eventName: 'partialResults', fn: (event: PartialResultsEvent) => void): Promise<VoiceListenerHandle>
  addListener(eventName: 'listeningState', fn: (event: ListeningStateEvent) => void): Promise<VoiceListenerHandle>
  addListener(eventName: 'error', fn: (event: ErrorEvent) => void): Promise<VoiceListenerHandle>
}

/** If the native 'stopped' event never arrives after a user stop, unstick the UI. */
const STOP_FALLBACK_MS = 2500

/** Human message for a session that ended in a recognizer error. */
function errorNotice(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'NO_MATCH':
    case 'SPEECH_TIMEOUT':
      return "Didn't catch that — try speaking again"
    case 'INSUFFICIENT_PERMISSIONS':
      return 'Microphone permission is off — allow it in system settings for Hermes Lens'
    case 'NETWORK':
    case 'NETWORK_TIMEOUT':
    case 'SERVER':
    case 'SERVER_DISCONNECTED':
      return 'The speech service is unreachable — check the connection and try again'
    case 'RECOGNIZER_BUSY':
      return 'The recognizer is busy — try again in a moment'
    default:
      return message !== undefined && message !== ''
        ? `Dictation failed: ${message}`
        : 'Dictation failed — try again'
  }
}

/**
 * Voice-to-text for the capture screen (@capgo/capacitor-speech-recognition,
 * the Capacitor-8 fork). Transcription is plain text fed into the normal
 * capture flow — no data-layer changes.
 *
 * Plugin session contract (matches the Android implementation):
 *  - start({partialResults: true}) resolves as soon as listening BEGINS, not
 *    when it ends. Treating that resolution as end-of-session silently tears
 *    the session down within milliseconds of the tap.
 *  - Transcripts (including the final one) arrive via 'partialResults' events.
 *  - End of session arrives via a 'listeningState' event with state 'stopped'
 *    (reason: results/silence/userStop/error), 'error' events carry the code.
 *
 * Every tap must produce a visible outcome: the OS permission prompt, the
 *  listening indicator, committed text, or a human notice via onNotice.
 */
export function useVoiceCapture(
  onFinalText: (text: string) => void,
  onNotice: (message: string) => void,
  internals?: { plugin?: VoicePluginLike; isNative?: boolean },
) {
  const plugin = internals?.plugin ?? SpeechRecognition
  const isNative = internals?.isNative ?? Capacitor.isNativePlatform()

  const [state, setState] = useState<VoiceState>('unavailable')
  const [partial, setPartial] = useState('')
  const stateRef = useRef<VoiceState>('unavailable')
  const transcript = useRef('')
  const subs = useRef<VoiceListenerHandle[]>([])
  const sessionSeq = useRef(0)
  const callbacks = useRef({ onFinalText, onNotice })

  useEffect(() => {
    callbacks.current = { onFinalText, onNotice }
  }, [onFinalText, onNotice])

  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const teardown = useCallback(() => {
    for (const sub of subs.current) {
      try {
        void sub.remove()
      } catch {
        // Listener already gone.
      }
    }
    subs.current = []
  }, [])

  useEffect(() => {
    if (!isNative) return
    let cancelled = false
    plugin
      .available()
      .then(({ available }) => {
        if (!cancelled && available) setVoiceState('idle')
      })
      .catch(() => {
        // Plugin missing or recognizer broken — stay 'unavailable'.
      })
    return () => {
      cancelled = true
      // eslint-disable-next-line react-hooks/exhaustive-deps -- session counter, not a DOM node; invalidating in-flight sessions on unmount is the point
      sessionSeq.current++
      teardown()
      if (stateRef.current === 'starting' || stateRef.current === 'listening') {
        void plugin.stop().catch(() => {
          // Nothing was running.
        })
      }
    }
  }, [isNative, plugin, setVoiceState, teardown])

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return
    const seq = ++sessionSeq.current
    const live = () => seq === sessionSeq.current
    setVoiceState('starting')

    let granted = false
    try {
      const perm = await plugin.requestPermissions()
      granted = perm.speechRecognition === 'granted'
    } catch {
      // The permission bridge itself failing means the recognizer is unusable.
      if (live()) {
        setVoiceState('unavailable')
        callbacks.current.onNotice("Speech recognition isn't available on this device")
      }
      return
    }
    if (!live()) return
    if (!granted) {
      setVoiceState('idle')
      callbacks.current.onNotice(
        'Microphone permission is off — allow it in system settings for Hermes Lens',
      )
      return
    }

    transcript.current = ''
    setPartial('')

    // Ends the session in the UI exactly once; `notice` is only shown when no
    // transcript was captured — committed text is its own visible outcome.
    const finalize = (notice?: string) => {
      if (!live()) return
      sessionSeq.current++
      teardown()
      const text = transcript.current.trim()
      transcript.current = ''
      setPartial('')
      setVoiceState('idle')
      if (text !== '') callbacks.current.onFinalText(text)
      else if (notice !== undefined) callbacks.current.onNotice(notice)
    }

    let lastError: ErrorEvent | null = null
    try {
      subs.current.push(
        await plugin.addListener('partialResults', (event) => {
          if (!live()) return
          const text = event.matches?.[0] ?? event.accumulatedText ?? ''
          if (text !== '') {
            transcript.current = text
            setPartial(text)
          }
        }),
      )
      subs.current.push(
        await plugin.addListener('error', (event) => {
          if (!live()) return
          lastError = event
        }),
      )
      subs.current.push(
        await plugin.addListener('listeningState', (event) => {
          if (!live()) return
          const sessionState = event.state ?? event.status
          if (sessionState !== 'stopped') return
          const code = event.errorCode ?? lastError?.code
          finalize(
            event.reason === 'error' || lastError !== null
              ? errorNotice(code, lastError?.message)
              : "Didn't catch that — nothing was heard",
          )
        }),
      )
    } catch {
      if (live()) {
        sessionSeq.current++
        teardown()
        setVoiceState('idle')
        callbacks.current.onNotice('Dictation failed — try again')
      }
      return
    }
    if (!live()) {
      teardown()
      return
    }

    try {
      // Resolves as soon as listening begins — the session then runs until a
      // 'stopped' listeningState event (silence, stop() or final results).
      await plugin.start({ partialResults: true, maxResults: 3 })
      if (live()) setVoiceState('listening')
    } catch (err) {
      if (!live()) return
      sessionSeq.current++
      teardown()
      setPartial('')
      setVoiceState('idle')
      const message = err instanceof Error ? err.message : String(err)
      callbacks.current.onNotice(
        /not available/i.test(message)
          ? "Speech recognition isn't available on this device"
          : `Couldn't start dictation: ${message}`,
      )
    }
  }, [plugin, setVoiceState, teardown])

  const stop = useCallback(() => {
    const seq = sessionSeq.current
    void plugin.stop().catch(() => {
      // Already stopped — the 'stopped' event settles the session either way.
    })
    // Native normally answers a stop with a 'stopped' event; if that is lost
    // (recognizer already idle), fall back to unsticking the UI ourselves.
    setTimeout(() => {
      if (seq !== sessionSeq.current) return
      if (stateRef.current !== 'listening' && stateRef.current !== 'starting') return
      sessionSeq.current++
      teardown()
      const text = transcript.current.trim()
      transcript.current = ''
      setPartial('')
      setVoiceState('idle')
      if (text !== '') callbacks.current.onFinalText(text)
    }, STOP_FALLBACK_MS)
  }, [plugin, setVoiceState, teardown])

  return { state, partial, start, stop }
}
