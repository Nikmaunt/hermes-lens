/*
 * Tolerant formatter for raw note text coming from the agent's vault.
 * Cached or legacy notes may still carry YAML frontmatter fences and raw
 * markdown; the server is being cleaned separately, but the app must render
 * such text gracefully forever (defense in depth). Deliberately NOT a
 * markdown renderer — it only:
 *   - hides a leading `---` frontmatter block (line-based or inline),
 *   - strips #/## heading marks and **bold** asterisks,
 *   - preserves line breaks (and treats inline heading marks as breaks),
 *   - surfaces [[wikilinks]] as plain highlighted words.
 * Anything it does not recognize passes through untouched.
 */

export interface NoteSegment {
  text: string
  wikilink: boolean
}

export interface NoteLine {
  segments: NoteSegment[]
  bullet: boolean
}

/**
 * Hide a leading YAML frontmatter fence. Handles the well-formed case
 * (`---\n…\n---`) and the flattened one-line case seen in real capture
 * payloads (`--- date: … time: … --- Body`). An unclosed fence is left
 * alone — better to show noise than to swallow the whole note.
 */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const multiline = /^---[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*---[ \t]*(\r?\n|$)/.exec(text)
  if (multiline !== null) return text.slice(multiline[0].length)
  const inline = /^---\s[\s\S]*?\s---(\s+|$)/.exec(text)
  if (inline !== null) return text.slice(inline[0].length)
  return text
}

/** Split on [[wikilinks]]; `[[target|alias]]` displays the alias. */
function toSegments(line: string): NoteSegment[] {
  const segments: NoteSegment[] = []
  let last = 0
  for (const match of line.matchAll(/\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g)) {
    const before = line.slice(last, match.index)
    if (before.length > 0) segments.push({ text: before, wikilink: false })
    segments.push({ text: (match[2] ?? match[1] ?? '').trim(), wikilink: true })
    last = match.index + match[0].length
  }
  const rest = line.slice(last)
  if (rest.length > 0 || segments.length === 0) segments.push({ text: rest, wikilink: false })
  return segments
}

export function parseNoteText(raw: string): NoteLine[] {
  let text = stripFrontmatter(raw.trim())

  // Inline heading marks act as line breaks — flattened legacy notes arrive
  // as one long line with `## Section` markers embedded mid-text.
  text = text.replace(/(^|\s)#{1,6}[ \t]+/g, '$1\n')

  // Bold is presentation-only here: drop the asterisks, keep the words.
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replaceAll('**', '')

  const lines: NoteLine[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue // paragraph gaps become line spacing in CSS
    const bullet = /^[-*][ \t]+/.test(line)
    lines.push({
      segments: toSegments(bullet ? line.replace(/^[-*][ \t]+/, '') : line),
      bullet,
    })
  }
  return lines
}

/** One-string variant for compact contexts (search snippets, feed previews). */
export function plainNoteText(raw: string): string {
  return parseNoteText(raw)
    .map((line) => line.segments.map((s) => s.text).join(''))
    .join('\n')
}
