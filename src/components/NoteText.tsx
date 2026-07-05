import { useMemo } from 'react'
import { parseNoteText } from '@/lib/noteText'

/**
 * Renders raw note text through the tolerant formatter (lib/noteText):
 * frontmatter hidden, heading/bold marks stripped, line breaks preserved,
 * [[wikilinks]] highlighted as plain accent words (not links — the vault
 * note graph lives on the agent, not in the app).
 */
export function NoteText({ text, className = '' }: { text: string; className?: string }) {
  const lines = useMemo(() => parseNoteText(text), [text])
  return (
    <div className={`space-y-1 ${className}`}>
      {lines.map((line, i) => (
        <p key={i} className={line.bullet ? 'flex gap-2' : undefined}>
          {line.bullet && (
            <span aria-hidden className="text-faint">
              •
            </span>
          )}
          <span>
            {line.segments.map((segment, j) =>
              segment.wikilink ? (
                <span key={j} className="text-accent font-medium">
                  {segment.text}
                </span>
              ) : (
                <span key={j}>{segment.text}</span>
              ),
            )}
          </span>
        </p>
      ))}
    </div>
  )
}
