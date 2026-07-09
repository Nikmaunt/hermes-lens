import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import { useSnackbar } from '@/components/SnackbarProvider'
import { BotIcon, MicIcon, RefreshIcon } from '@/components/icons'
import { preferencesKV } from '@/data/kv'
import { tapMedium } from '@/lib/haptics'
import { useVoiceCapture } from '@/features/capture/voice'
import type { ChatErrorReason } from './chatTurn'
import { computePendingTurn, type PendingTurn } from './pendingTurn'
import {
  appendExchange,
  clearTranscript,
  loadTranscript,
  type ChatMessage,
  type ChatTranscript,
} from './transcript'
import { useChatController } from './useChatController'

const EMPTY: ChatTranscript = { sessionId: null, messages: [] }

/** Full-screen /chat: a rolling conversation with the Hermes agent (Release A). */
export function ChatScreen() {
  const { active, view, sending, sendError, attempted, send: startSend, retry, dismiss } =
    useChatController()
  const snackbar = useSnackbar()
  const location = useLocation()
  const navigate = useNavigate()
  const [transcript, setTranscript] = useState<ChatTranscript>(EMPTY)
  const [ready, setReady] = useState(false)
  const appendedJob = useRef<string | null>(null)
  const askHandledRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void loadTranscript(preferencesKV).then((t) => {
      setTranscript(t)
      setReady(true)
    })
  }, [])

  // Move a completed turn into the rolling transcript once, then free the
  // pending slot. sessionId is carried so the next send continues it (D-A7).
  useEffect(() => {
    if (active === null || view.phase !== 'done') return
    if (appendedJob.current === active.jobId) return
    appendedJob.current = active.jobId
    const { userMessage, sessionId } = active
    const { reply, tokensUsed } = view
    void (async () => {
      const next = await appendExchange(preferencesKV, {
        userMessage,
        reply,
        sessionId,
        at: new Date().toISOString(),
        ...(tokensUsed === null ? {} : { tokensUsed }),
      })
      setTranscript(next)
      dismiss()
    })()
  }, [active, view, dismiss])

  const pending = computePendingTurn({ sending, sendError, attemptedMessage: attempted, active, view })
  const inFlight = pending?.status === 'sending' || pending?.status === 'thinking'

  // Keep the newest bubble in view as the conversation grows. Guarded: not
  // every runtime implements scrollIntoView (jsdom, some WebViews).
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [transcript.messages.length, pending?.status])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '' || inFlight) return
      tapMedium()
      startSend(trimmed, transcript.sessionId ?? undefined)
    },
    [startSend, transcript.sessionId, inFlight],
  )

  // Capture handoff: a question arrived from the Note|Ask composer (D-A4). Send
  // it once the transcript (and its rolling sessionId) has loaded so it
  // continues the same session, then consume the router state so a back/refresh
  // does not resend it.
  useEffect(() => {
    if (!ready || askHandledRef.current) return
    const ask = (location.state as { ask?: string } | null)?.ask
    if (typeof ask !== 'string' || ask.trim() === '') return
    askHandledRef.current = true
    send(ask.trim())
    void navigate('/chat', { replace: true, state: null })
  }, [ready, location.state, send, navigate])

  const startNew = useCallback(() => {
    appendedJob.current = null
    dismiss()
    void clearTranscript(preferencesKV).then(setTranscript)
  }, [dismiss])

  const showEmpty = transcript.messages.length === 0 && pending === null

  return (
    <Screen
      title="Ask Hermes"
      actions={
        transcript.messages.length > 0 ? (
          <button
            onClick={startNew}
            className="rounded-full px-2 py-1 text-caption text-muted active:bg-raised"
          >
            New
          </button>
        ) : undefined
      }
    >
      <div className="flex min-h-[68vh] flex-col">
        <div className="flex-1">
          {showEmpty ? (
            <EmptyChat />
          ) : (
            <div className="flex flex-col gap-3 pb-4">
              {transcript.messages.map((m, i) => (
                <MessageBubble key={`${m.at}-${m.role}-${i}`} message={m} />
              ))}
              {pending !== null && (
                <PendingBubbles pending={pending} onRetry={retry} onDismiss={dismiss} />
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        <Composer
          onSend={send}
          disabled={inFlight}
          onNotice={(message) => snackbar.show({ message })}
        />
      </div>
    </Screen>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return message.role === 'user' ? (
    <UserBubble text={message.text} />
  ) : (
    <AssistantBubble text={message.text} tokensUsed={message.tokensUsed ?? null} />
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-accent text-accent-ink max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-body whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}

function AssistantBubble({ text, tokensUsed }: { text: string; tokensUsed: number | null }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="border-line bg-surface max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-2.5 text-body whitespace-pre-wrap">
        {text}
      </div>
      {tokensUsed !== null && (
        <span className="pl-1 text-micro text-faint">{tokensUsed.toLocaleString()} tokens</span>
      )}
    </div>
  )
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-muted" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="bg-muted h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="text-caption">{label}</span>
    </div>
  )
}

function errorText(reason: ChatErrorReason | null, message: string | null): string {
  switch (reason) {
    case 'expired':
      return 'This turn expired before it finished — ask again.'
    case 'timeout':
      return 'Hermes took too long to answer. Try again.'
    case 'offline':
      return "Couldn't reach Hermes — check your connection and retry."
    case 'agent':
      return message ?? 'Hermes hit an error answering. Try again.'
    default:
      return message ?? 'Something went wrong. Try again.'
  }
}

function ErrorBubble({
  reason,
  message,
  onRetry,
  onDismiss,
}: {
  reason: ChatErrorReason | null
  message: string | null
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div
      className="border-danger/40 bg-danger-dim max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-3"
      role="alert"
    >
      <div className="text-danger text-caption">{errorText(reason, message)}</div>
      <div className="mt-2 flex gap-4">
        <button
          onClick={onRetry}
          className="text-accent inline-flex items-center gap-1 text-caption font-medium active:opacity-70"
        >
          <RefreshIcon size={14} /> Retry
        </button>
        <button onClick={onDismiss} className="text-caption text-muted active:opacity-70">
          Dismiss
        </button>
      </div>
    </div>
  )
}

function PendingBubbles({
  pending,
  onRetry,
  onDismiss,
}: {
  pending: PendingTurn
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <>
      <UserBubble text={pending.userMessage} />
      {pending.status === 'sending' && <ThinkingBubble label="Sending…" />}
      {pending.status === 'thinking' && <ThinkingBubble label="Hermes is thinking…" />}
      {pending.status === 'done' && pending.reply !== null && (
        <AssistantBubble text={pending.reply} tokensUsed={pending.tokensUsed} />
      )}
      {pending.status === 'error' && (
        <ErrorBubble
          reason={pending.errorReason}
          message={pending.errorMessage}
          onRetry={onRetry}
          onDismiss={onDismiss}
        />
      )}
    </>
  )
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center gap-3 pt-16 text-center">
      <div className="border-accent/40 text-accent flex h-14 w-14 items-center justify-center rounded-2xl border">
        <BotIcon size={26} />
      </div>
      <div className="text-body font-medium">Ask Hermes anything</div>
      <p className="max-w-xs text-caption text-faint">
        Your agent thinks for a moment, then replies in one go. This conversation stays on your
        device.
      </p>
    </div>
  )
}

function Composer({
  onSend,
  disabled,
  onNotice,
}: {
  onSend: (text: string) => void
  disabled: boolean
  onNotice: (message: string) => void
}) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const voice = useVoiceCapture(
    (spoken) => setText((prev) => (prev.trim() === '' ? spoken : `${prev.trimEnd()} ${spoken}`)),
    onNotice,
  )
  const voiceLive = voice.state === 'starting' || voice.state === 'listening'

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed === '' || disabled) return
    setText('')
    onSend(trimmed)
    textareaRef.current?.focus()
  }

  return (
    <div
      className="bg-bg/85 sticky bottom-0 pt-2 backdrop-blur-md"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
    >
      {voiceLive && (
        <div className="border-accent/40 bg-accent-dim mb-2 rounded-lg border px-3 py-2">
          <div className="text-accent flex items-center gap-2 text-xs font-medium">
            <span
              className="bg-danger inline-block h-2 w-2 animate-pulse rounded-full"
              aria-hidden
            />
            {voice.state === 'starting' ? 'Starting the recognizer…' : 'Listening — tap to stop'}
          </div>
          {voice.partial !== '' && (
            <div className="mt-1 text-sm text-muted" aria-live="polite">
              {voice.partial}
            </div>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Ask Hermes…"
          rows={1}
          className="border-line bg-surface max-h-40 min-h-[2.75rem] w-full resize-none rounded-(--radius-card) border p-3 text-body leading-relaxed outline-none placeholder:text-faint focus:border-accent focus-visible:outline-none"
        />
        {voice.state !== 'unavailable' && (
          <button
            onClick={() => (voiceLive ? voice.stop() : void voice.start())}
            aria-label={voiceLive ? 'Stop dictation' : 'Dictate a message'}
            aria-pressed={voiceLive}
            className={`flex h-[2.75rem] w-12 shrink-0 items-center justify-center rounded-(--radius-card) border transition-colors ${
              voiceLive
                ? 'border-danger bg-danger-dim text-danger'
                : 'border-line bg-surface text-muted active:bg-raised'
            }`}
          >
            <MicIcon size={20} className={voice.state === 'listening' ? 'animate-pulse' : ''} />
          </button>
        )}
        <button
          onClick={submit}
          disabled={text.trim() === '' || disabled}
          className="bg-accent text-accent-ink h-[2.75rem] shrink-0 rounded-(--radius-card) px-5 text-body font-semibold transition-colors active:opacity-80 disabled:bg-raised disabled:text-faint"
        >
          Send
        </button>
      </div>
    </div>
  )
}
