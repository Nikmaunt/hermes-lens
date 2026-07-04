import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'

export type VoiceState = 'unavailable' | 'idle' | 'recording'

/**
 * Voice-to-text for the capture screen (@capgo/capacitor-speech-recognition,
 * the Capacitor-8 fork). Transcription is plain text fed into the normal
 * capture flow — no data-layer changes. Degrades gracefully: in the browser,
 * without a recognizer, or with the permission declined, the mic simply is
 * not offered and typing keeps working.
 */
export function useVoiceCapture(onFinalText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('unavailable')
  const [partial, setPartial] = useState('')
  const lastPartial = useRef('')
  const finalTextRef = useRef(onFinalText)

  useEffect(() => {
    finalTextRef.current = onFinalText
  }, [onFinalText])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    SpeechRecognition.available()
      .then(({ available }) => {
        if (!cancelled && available) setState('idle')
      })
      .catch(() => {
        // Plugin missing or recognizer broken — stay 'unavailable'.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const start = useCallback(async () => {
    try {
      const perm = await SpeechRecognition.requestPermissions()
      if (perm.speechRecognition !== 'granted') return
    } catch {
      setState('unavailable')
      return
    }

    lastPartial.current = ''
    setPartial('')
    setState('recording')
    const sub = await SpeechRecognition.addListener('partialResults', (event) => {
      const text = event.matches?.[0] ?? event.accumulatedText ?? ''
      if (text !== '') {
        lastPartial.current = text
        setPartial(text)
      }
    })
    try {
      // Resolves when recognition ends (silence, stop() or final results).
      const { matches } = await SpeechRecognition.start({ partialResults: true, maxResults: 3 })
      const final = matches?.[0] ?? lastPartial.current
      if (final.trim() !== '') finalTextRef.current(final.trim())
    } catch {
      // Recognizer error or no speech: salvage the last partial, if any.
      if (lastPartial.current.trim() !== '') finalTextRef.current(lastPartial.current.trim())
    } finally {
      void sub.remove()
      setPartial('')
      setState('idle')
    }
  }, [])

  const stop = useCallback(() => {
    void SpeechRecognition.stop().catch(() => {
      // Already stopped — the start() promise settles either way.
    })
  }, [])

  return { state, partial, start, stop }
}
