import { useRef, useState } from 'react'
import { Screen } from '@/components/Screen'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useCapture } from '@/hooks/mutations'

const QUICK_TAGS = ['idea', 'todo', 'polish', 'novel', 'money', 'apartment'] as const

export function CaptureScreen() {
  const [text, setText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const capture = useCapture()
  const snackbar = useSnackbar()

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
    // Optimistic: clear instantly, report async result via snackbar.
    setText('')
    setTags([])
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
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind?"
        rows={5}
        autoFocus
        className="w-full resize-none rounded-(--radius-card) border border-line bg-surface p-4 text-[15px] leading-relaxed outline-none placeholder:text-faint focus:border-accent"
      />

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

      <button
        onClick={submit}
        disabled={text.trim() === ''}
        className="bg-accent text-accent-ink mt-5 w-full rounded-(--radius-card) py-3.5 text-[15px] font-semibold transition-opacity active:opacity-80 disabled:opacity-30"
      >
        Send to Hermes
      </button>
      <p className="mt-3 text-center text-[11px] text-faint">
        Lands in the agent's inbox. Works offline — queued captures sync on reconnect.
      </p>
    </Screen>
  )
}
