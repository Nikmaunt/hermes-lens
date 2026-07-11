import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { FilterChip } from '@/components/FilterChip'
import { Screen } from '@/components/Screen'
import { useSnackbar } from '@/components/SnackbarProvider'
import { ConfirmDialog } from '@/components/primitives'
import { MicIcon, ShareIcon } from '@/components/icons'
import { useCapture, useQueueCommand, type CommandDraft } from '@/hooks/mutations'
import { tapMedium } from '@/lib/haptics'
import { useVoiceCapture } from './voice'

const QUICK_TAGS = ['idea', 'todo', 'polish', 'novel', 'money', 'apartment'] as const

type Mode = 'note' | 'ask' | 'command'
type CommandType = CommandDraft['type']

const MODE_LABELS: Record<Mode, string> = { note: 'Note', ask: 'Ask', command: 'Command' }
const SUBMIT_LABELS: Record<Mode, string> = {
  note: 'Send to Hermes',
  ask: 'Ask Hermes',
  command: 'Queue command',
}

// The command types the composer can queue; per-type copy for the shared
// textarea (digest: the topic; person note: the note body).
const COMMAND_PLACEHOLDERS: Record<CommandType, string> = {
  'adhoc-digest': 'What should the digest cover?',
  'create-note': 'What should the note say?',
}
// Sidecar payload caps: topic ≤ 500, note text ≤ 4096.
const COMMAND_TEXT_CAPS: Record<CommandType, number> = {
  'adhoc-digest': 500,
  'create-note': 4096,
}

export function CaptureScreen() {
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [fromShare, setFromShare] = useState(false)
  // Note is primary (a quick capture); Ask hands the composed text to /chat;
  // Command queues a fire-and-forget job for the agent's next run.
  const [mode, setMode] = useState<Mode>('note')
  const [commandType, setCommandType] = useState<CommandType>('adhoc-digest')
  const [person, setPerson] = useState('')
  const [personTitle, setPersonTitle] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const capture = useCapture()
  const queueCommand = useQueueCommand()
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

  const isAsk = mode === 'ask'
  const isCommand = mode === 'command'
  // A person note needs to know who it is about before it can queue.
  const commandReady = commandType === 'adhoc-digest' || person.trim() !== ''

  /** Confirmed: build the request and hand it to the queue-or-send policy. */
  const queueDraft = () => {
    const trimmed = text.trim()
    setConfirmOpen(false)
    if (trimmed === '' || queueCommand.isPending) return
    tapMedium() // command committed
    const draft: CommandDraft =
      commandType === 'adhoc-digest'
        ? { type: 'adhoc-digest', payload: { topic: trimmed } }
        : {
            type: 'create-note',
            payload: {
              target: 'people',
              person: person.trim(),
              ...(personTitle.trim() === '' ? {} : { title: personTitle.trim() }),
              text: trimmed,
            },
          }
    // Optimistic: clear instantly; the command is queued either way (direct
    // accept or offline queue), so one snackbar covers both outcomes.
    setText('')
    setPerson('')
    setPersonTitle('')
    textareaRef.current?.focus()
    queueCommand.mutate(draft, {
      onSuccess: () => {
        snackbar.show({ message: 'Command queued' })
      },
    })
  }

  const submit = () => {
    const trimmed = text.trim()
    if (trimmed === '') return
    if (isAsk) {
      // Hand the question to /chat, which owns the whole agent turn (D-A4).
      tapMedium()
      void navigate('/chat', { state: { ask: trimmed } })
      return
    }
    if (isCommand) {
      // Nothing is sent yet — the ConfirmDialog owns the commit.
      if (commandReady) setConfirmOpen(true)
      return
    }
    if (capture.isPending) return
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
      <div className="mb-3 inline-flex rounded-(--radius-card) border border-line bg-surface p-0.5 text-xs font-medium">
        {(['note', 'ask', 'command'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-[calc(var(--radius-card)-2px)] px-5 py-1.5 transition-colors ${
              mode === m ? 'bg-accent text-accent-ink' : 'text-muted'
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {fromShare && (
        <div className="bg-accent-dim text-accent mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
          <ShareIcon size={14} className="shrink-0" />
          <span>Shared text — review, tag and send to Hermes</span>
        </div>
      )}
      {isCommand && (
        <div className="mb-3">
          <div className="flex gap-1.5">
            <FilterChip
              active={commandType === 'adhoc-digest'}
              onClick={() => setCommandType('adhoc-digest')}
            >
              Digest
            </FilterChip>
            <FilterChip
              active={commandType === 'create-note'}
              onClick={() => setCommandType('create-note')}
            >
              Person note
            </FilterChip>
          </div>
          {commandType === 'create-note' && (
            <div className="mt-3 space-y-2">
              <input
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                placeholder="Who is it about?"
                maxLength={120}
                className="w-full rounded-(--radius-card) border border-line bg-surface px-4 py-3 text-body outline-none placeholder:text-faint focus:border-accent focus-visible:outline-none"
              />
              <input
                value={personTitle}
                onChange={(e) => setPersonTitle(e.target.value)}
                placeholder="Title (optional)"
                maxLength={120}
                className="w-full rounded-(--radius-card) border border-line bg-surface px-4 py-3 text-body outline-none placeholder:text-faint focus:border-accent focus-visible:outline-none"
              />
            </div>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          isCommand
            ? COMMAND_PLACEHOLDERS[commandType]
            : isAsk
              ? 'Ask Hermes anything…'
              : "What's on your mind?"
        }
        rows={5}
        autoFocus
        maxLength={isCommand ? COMMAND_TEXT_CAPS[commandType] : undefined}
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

      {mode === 'note' && (
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
      )}

      <div className="mt-5 flex gap-2">
        <button
          onClick={submit}
          disabled={text.trim() === '' || (isCommand && !commandReady)}
          className="bg-accent text-accent-ink flex-1 rounded-(--radius-card) py-3.5 text-body font-semibold transition-colors active:opacity-80 disabled:bg-raised disabled:text-faint"
        >
          {SUBMIT_LABELS[mode]}
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
      {mode === 'note' && (
        <p className="mt-3 text-center text-caption text-faint">
          Lands in the agent's inbox. Works offline — queued captures sync on reconnect.
        </p>
      )}
      {isCommand && (
        <p className="mt-3 text-center text-caption text-faint">
          Runs on the agent's next pass. Track progress under More → Commands.
        </p>
      )}
      {confirmOpen && (
        <ConfirmDialog
          title="Queue this command?"
          body="Hermes will pick it up on its next run — usually within 30 minutes."
          confirmLabel="Queue"
          tone="accent"
          onConfirm={queueDraft}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </Screen>
  )
}
