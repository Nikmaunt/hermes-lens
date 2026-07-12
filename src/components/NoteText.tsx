import { useMemo } from 'react'
import { parseNoteText } from '@/lib/noteText'

/**
 * Renders raw note text through the tolerant formatter (lib/noteText):
 * frontmatter hidden, heading/bold marks stripped, line breaks preserved,
 * [[wikilinks]] highlighted as plain accent words (not links — the vault
 * note graph lives on the agent, not in the app). http(s) segments render
 * as anchors; the Capacitor WebView hands external navigations to the
 * system browser, and target="_blank" keeps dev-in-browser behaving too.
 */
export function NoteText({ text, className = '' }: { text: string; className?: string }) {
  const lines = useMemo(() => parseNoteText(text), [text])
  return (
    // min-w-0 + break-words: a 200-char URL or token must wrap inside flex
    // parents instead of forcing the screen to scroll sideways.
    <div className={`min-w-0 space-y-1 break-words ${className}`}>
      {lines.map((line, i) => (
        <p key={i} className={line.bullet ? 'flex gap-2' : undefined}>
          {line.bullet && (
            <span aria-hidden className="text-faint">
              •
            </span>
          )}
          <span className="min-w-0">
            {line.segments.map((segment, j) =>
              segment.href !== undefined ? (
                <a
                  key={j}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline underline-offset-2"
                >
                  {segment.text}
                </a>
              ) : segment.wikilink ? (
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
