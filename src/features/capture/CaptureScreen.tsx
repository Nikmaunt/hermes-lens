import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import { useSnackbar } from '@/components/SnackbarProvider'
import { MicIcon, ShareIcon } from '@/components/icons'
import { useCapture } from '@/hooks/mutations'
import { tapMedium } from '@/lib/haptics'
import { useVoiceCapture } from './voice'

const QUICK_TAGS = ['idea', 'todo', 'polish', 'novel', 'money', 'apartment'] as const

export function CaptureScreen() {
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [fromShare, setFromShare] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const capture = useCapture()
  const snackbar = useSnackbar()
  const location = useLocation()
  const navigate = useNavigate()
  const voice = useVoiceCapture(
    (spoken) => {
      setText((prev) => (prev.trim() === '' ? spoken : `${prev.trimEnd()}\n${spoken}`))
    },
    (notice) => snackbar.show({ message: notice }),
  )
  const voiceLive = voice.state === 'starting' || voice.state === 'listening'

  // Text arriving from the Android share sheet prefills the note for review —
  // nothing is sent until the user confirms with the normal Send button.
  useEffect(() => {
    const shared = (location.state as { sharedText?: string } | null)?.sharedText
    if (typeof shared !== 'string' || shared.trim() === '') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state arrives via router navigation, not render data; must be consumed exactly once
    setText((prev) => (prev.trim() === '' ? shared : `${prev.trimEnd()}\n${shared}`))
    setFromShare(true)
    // Consume the state so back/refresh does not prefill again.
    void navigate('/capture', { replace: true })
  }, [location.state, navigate])

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const addDraftTag = () => {
    const tag = tagDraft.trim().toLowerCase()
    if (tag !== '' && !tags.includes(tag)) setTags((prev) => [...prev, tag])
    setTagDraft('')
  }

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed === '' || capture.isPending) return
    tapMedium() // capture committed
    // Optimistic: clear instantly, report async result via snackbar.
    setText('')
    setTags([])
    setFromShare(false)
    textareaRef.current?.focus()
    capture.mutate(
      { text: trimmed, tags },
      {
        onSuccess: ({ queued }) => {
          snackbar.show({
            message: queued ? 'Saved offline — will sync when the agent is back' : 'Captured ✓',
          })
        },
      },
    )
  }

  return (
    <Screen title="Capture">
      {fromShare && (
        <div className="bg-accent-dim text-accent mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
          <ShareIcon size={14} className="shrink-0" />
          <span>Shared text — review, tag and send to Hermes</span>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind?"
        rows={5}
        autoFocus
        className="w-full resize-none rounded-(--radius-card) border border-line bg-surface p-4 text-body leading-relaxed outline-none placeholder:text-faint focus:border-accent focus-visible:outline-none"
      />

      {voiceLive && (
        <div className="border-accent/40 bg-accent-dim mt-3 rounded-lg border px-3 py-2">
          <div className="text-accent flex items-center gap-2 text-xs font-medium">
            <span className="bg-danger inline-block h-2 w-2 animate-pulse rounded-full" aria-hidden />
            {voice.state === 'starting' ? 'Starting the recognizer…' : 'Listening — tap the mic to stop'}
          </div>
          {voice.partial !== '' && (
            <div className="mt-1 text-sm text-muted" aria-live="polite">
              {voice.partial}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {QUICK_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              tags.includes(tag)
                ? 'bg-accent-dim text-accent'
                : 'bg-surface border border-line text-muted'
            }`}
          >
            #{tag}
          </button>
        ))}
        {tags
          .filter((t) => !QUICK_TAGS.includes(t as (typeof QUICK_TAGS)[number]))
          .map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className="bg-accent-dim text-accent rounded-full px-3 py-1.5 text-xs font-medium"
            >
              #{tag} ×
            </button>
          ))}
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addDraftTag()
            }
          }}
          onBlur={addDraftTag}
          placeholder="+ tag"
          className="w-20 bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-faint"
        />
      </div>

      <div className="mt-5 flex gap-2">
        <button
          onClick={submit}
          disabled={text.trim() === ''}
          className="bg-accent text-accent-ink flex-1 rounded-(--radius-card) py-3.5 text-body font-semibold transition-colors active:opacity-80 disabled:bg-raised disabled:text-faint"
        >
          Send to Hermes
        </button>
        {voice.state !== 'unavailable' && (
          <button
            onClick={() => (voiceLive ? voice.stop() : void voice.start())}
            aria-label={voiceLive ? 'Stop dictation' : 'Dictate a note'}
            aria-pressed={voiceLive}
            className={`flex w-14 items-center justify-center rounded-(--radius-card) border transition-colors ${
              voiceLive
                ? 'border-danger bg-danger-dim text-danger'
                : 'border-line bg-surface text-muted active:bg-raised'
            }`}
          >
            <MicIcon size={22} className={voice.state === 'listening' ? 'animate-pulse' : ''} />
          </button>
        )}
      </div>
      <p className="mt-3 text-center text-caption text-faint">
        Lands in the agent's inbox. Works offline — queued captures sync on reconnect.
      </p>
    </Screen>
  )
}
