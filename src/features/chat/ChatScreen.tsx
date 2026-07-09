import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import { useSnackbar } from '@/components/SnackbarProvider'
import { ArrowUpIcon, BotIcon, MicIcon, RefreshIcon } from '@/components/icons'
import { preferencesKV } from '@/data/kv'
import { tapMedium } from '@/lib/haptics'
import { useVoiceCapture } from '@/features/capture/voice'
import type { ChatErrorReason } from './chatTurn'
import { autoGrowTextarea, composerRightAction } from './composerLayout'
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
      fill
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
      {/* Fix A: /chat is a fixed-height column (Screen `fill`). The message
          list is the ONLY scroller — the document never scrolls — and
          overscroll-none keeps a bottom bounce from dragging anything off the
          fixed BottomNav. The bottom padding lives inside the list (not the
          page) so nothing scrolls under the composer. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        {showEmpty ? (
          <EmptyChat />
        ) : (
          <div className="flex flex-col gap-3 pb-3">
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
      {/* Composer is an ordinary bottom flex child (not sticky): the column
          height already reserves the BottomNav, so it sits flush above it at
          any scroll position. */}
      <Composer
        onSend={send}
        disabled={inFlight}
        onNotice={(message) => snackbar.show({ message })}
      />
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
    <div className="animate-fade-up flex items-center gap-2 text-muted" aria-live="polite">
      <span className="border-line bg-surface flex items-center gap-1 rounded-2xl rounded-bl-sm border px-3.5 py-3">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="bg-muted animate-thinking h-1.5 w-1.5 rounded-full"
            style={{ animationDelay: `${delay}ms` }}
            aria-hidden
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
      className="border-danger/40 bg-danger-dim animate-fade-up max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-3"
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

/**
 * The chat composer: a full-width field with a single contextual control on
 * its right (mic when empty and dictation is available, Send once there is
 * text — ChatGPT pattern). The field auto-grows with its content up to a cap,
 * then scrolls internally. Exported for a focused component test.
 */
export function Composer({
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
  const voiceAvailable = voice.state !== 'unavailable'

  // Fit the field to its content before paint. Typed, pasted and voice-appended
  // text all flow through `text`, so this one effect covers every path.
  useLayoutEffect(() => {
    autoGrowTextarea(textareaRef.current)
  }, [text])

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed === '' || disabled) return
    setText('')
    onSend(trimmed)
    textareaRef.current?.focus()
  }

  const showSend = composerRightAction(text, voiceAvailable) === 'send'
  const sendDisabled = text.trim() === '' || disabled

  return (
    <div className="border-line bg-bg border-t pt-3 pb-2">
      {voiceLive && (
        <div className="border-accent/40 bg-accent-dim mb-2 rounded-lg border px-3 py-2">
          <div className="text-accent flex items-center gap-2 text-xs font-medium">
            <span
              className="bg-danger inline-block h-2 w-2 animate-pulse rounded-full motion-reduce:animate-none"
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
      <div className="border-line bg-surface focus-within:border-accent relative flex items-end rounded-(--radius-card) border transition-colors">
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
          className="max-h-40 min-h-[2.75rem] w-full resize-none overflow-y-auto bg-transparent py-3 pr-14 pl-3.5 text-body leading-relaxed outline-none placeholder:text-faint focus-visible:outline-none"
        />
        {/* One slot, two stacked controls that cross-fade so the swap is smooth
            (and instant under reduced motion). Only the shown one is focusable. */}
        <div className="absolute right-1.5 bottom-1.5 h-9 w-9">
          {voiceAvailable && (
            <button
              onClick={() => (voiceLive ? voice.stop() : void voice.start())}
              aria-label={voiceLive ? 'Stop dictation' : 'Dictate a message'}
              aria-pressed={voiceLive}
              aria-hidden={showSend}
              tabIndex={showSend ? -1 : 0}
              className={`absolute inset-0 flex items-center justify-center rounded-full transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
                showSend ? 'pointer-events-none scale-90 opacity-0' : 'opacity-100'
              } ${voiceLive ? 'bg-danger-dim text-danger' : 'text-muted active:bg-raised'}`}
            >
              <MicIcon
                size={20}
                className={
                  voice.state === 'listening' ? 'animate-pulse motion-reduce:animate-none' : ''
                }
              />
            </button>
          )}
          <button
            onClick={submit}
            disabled={sendDisabled}
            aria-label="Send"
            aria-hidden={!showSend}
            tabIndex={showSend ? 0 : -1}
            className={`bg-accent text-accent-ink absolute inset-0 flex items-center justify-center rounded-full transition-[opacity,transform] duration-150 ease-out active:opacity-80 disabled:bg-raised disabled:text-faint motion-reduce:transition-none ${
              showSend ? 'opacity-100' : 'pointer-events-none scale-90 opacity-0'
            }`}
          >
            <ArrowUpIcon size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
