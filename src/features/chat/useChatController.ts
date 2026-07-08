import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useQueryClient } from '@tanstack/react-query'
import { useData } from '@/data/DataSourceProvider'
import { preferencesKV } from '@/data/kv'
import {
  clearActiveTurn,
  isTerminalView,
  loadActiveTurn,
  startTurn,
  type ActiveChatTurn,
} from './activeChat'
import { chatErrorReason, type ChatErrorReason, type ChatTurnView } from './chatTurn'
import { useChatJobPoll } from './useChatJobPoll'

interface StartInput {
  message: string
  clientId: string
  sessionId?: string
}

export interface ChatController {
  /** The accepted (or last, until dismissed) turn being polled, or null when idle. */
  active: ActiveChatTurn | null
  /** Poll view of `active`. Meaningful only while `active` is non-null. */
  view: ChatTurnView
  /** POST is in flight; no jobId yet — the "sending…" bubble state. */
  sending: boolean
  /** The POST itself failed (offline/unreachable). Never queued (D-A9). */
  sendError: ChatErrorReason | null
  /** Message of the current attempt, before/independent of an accepted jobId. */
  attempted: string | null
  /** Start a new turn. sessionId continues the rolling session (D-A7). */
  send: (message: string, sessionId?: string) => void
  /** Re-send the last turn with the SAME clientId → server dedup (D-A8). */
  retry: () => void
  /** Free the pending slot (turn moved to transcript, or error acknowledged). */
  dismiss: () => void
}

/**
 * Owns the lifecycle of the single active chat turn and its re-attachment
 * (D-A6). On mount it re-adopts a persisted in-flight turn (this is what
 * survives a 30s relock that unmounts the screen, and a full app kill); on
 * foreground it kicks an immediate poll (a backgrounded WebView throttles
 * refetchInterval); on any terminal view it clears the persisted handle so a
 * later reattach never re-polls a finished or dead job.
 */
export function useChatController(): ChatController {
  const { ds } = useData()
  const queryClient = useQueryClient()

  const [active, setActive] = useState<ActiveChatTurn | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<ChatErrorReason | null>(null)
  const [attempted, setAttempted] = useState<string | null>(null)

  // The last attempt, kept so retry() reuses the same clientId even after a
  // POST failure (no jobId yet) or a fresh mount that re-adopted a turn.
  const lastAttempt = useRef<StartInput | null>(null)
  // Guards the terminal-clear so it runs once per turn.
  const terminalCleared = useRef(false)

  const view = useChatJobPoll(active?.jobId ?? null, active?.startedAt ?? null)

  const doStart = useCallback(
    async (input: StartInput): Promise<void> => {
      lastAttempt.current = input
      setAttempted(input.message)
      setSendError(null)
      setSending(true)
      try {
        const turn = await startTurn(ds, preferencesKV, input)
        terminalCleared.current = false
        setActive(turn)
      } catch (err) {
        // Offline / unreachable at POST time: explicit fail + retry, and
        // deliberately NOT enqueued — a blind replay would start a second turn
        // and lose the reply (D-A9).
        setSendError(chatErrorReason(err))
      } finally {
        setSending(false)
      }
    },
    [ds],
  )

  const send = useCallback(
    (message: string, sessionId?: string): void => {
      const clientId = crypto.randomUUID()
      void doStart({ message, clientId, ...(sessionId === undefined ? {} : { sessionId }) })
    },
    [doStart],
  )

  const retry = useCallback((): void => {
    // Prefer the accepted turn's ids (survive a reattach); fall back to the last
    // attempt (a POST that never got a jobId).
    const base: StartInput | null =
      active !== null
        ? { message: active.userMessage, clientId: active.clientId, sessionId: active.sessionId }
        : lastAttempt.current
    if (base === null) return
    void doStart(base)
  }, [active, doStart])

  const dismiss = useCallback((): void => {
    setActive(null)
    setAttempted(null)
    setSendError(null)
  }, [])

  // Re-adopt a persisted in-flight turn on mount (unlock-remount, app kill).
  useEffect(() => {
    let alive = true
    void loadActiveTurn(preferencesKV).then((turn) => {
      if (alive && turn !== null) {
        terminalCleared.current = false
        setActive(turn)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  // Clear the persisted handle the moment the turn is terminal — a finished or
  // dead job must never be re-polled on a later reattach (D-A6). The resolved
  // turn stays in memory so its bubble renders until the screen dismisses it.
  useEffect(() => {
    if (active === null || terminalCleared.current) return
    if (!isTerminalView(view)) return
    terminalCleared.current = true
    void clearActiveTurn(preferencesKV)
  }, [view, active])

  // A backgrounded WebView throttles refetchInterval; kick an immediate poll on
  // return so a turn that resolved while away is picked up at once.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || active === null) return
    const jobId = active.jobId
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void queryClient.invalidateQueries({ queryKey: ['chat-job', jobId] })
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [active, queryClient])

  return { active, view, sending, sendError, attempted, send, retry, dismiss }
}
