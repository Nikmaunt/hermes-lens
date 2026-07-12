import { describe, expect, it } from 'vitest'
import { parseNoteText, plainNoteText } from './noteText'

/** The real-world ugly capture that motivated the formatter, verbatim. */
const UGLY =
  '--- date: 2026-07-07 time: 19:00 criticality: high category: appointment --- ' +
  '# Boiler inspection **Date:** Tuesday, 7 July 2026 **Time:** 19:00 ' +
  '## Important ⚠️ Critical — do not miss. ## Related - [[followups]]'

describe('parseNoteText', () => {
  it('renders the real-world ugly sample as clean lines', () => {
    const lines = parseNoteText(UGLY)
    expect(lines.map((l) => l.segments.map((s) => s.text).join(''))).toEqual([
      'Boiler inspection Date: Tuesday, 7 July 2026 Time: 19:00',
      'Important ⚠️ Critical — do not miss.',
      'Related - followups',
    ])
    const last = lines[2]?.segments ?? []
    expect(last).toEqual([
      { text: 'Related - ', wikilink: false },
      { text: 'followups', wikilink: true },
    ])
  })

  it('hides a well-formed multiline frontmatter block', () => {
    const lines = parseNoteText(
      '---\ndate: 2026-07-07\ntime: 19:00\n---\n# Inspection\n**Date:** Tuesday\n## Related\n- [[followups]]',
    )
    expect(lines).toEqual([
      { segments: [{ text: 'Inspection', wikilink: false }], bullet: false },
      { segments: [{ text: 'Date: Tuesday', wikilink: false }], bullet: false },
      { segments: [{ text: 'Related', wikilink: false }], bullet: false },
      { segments: [{ text: 'followups', wikilink: true }], bullet: true },
    ])
  })

  it('leaves an unclosed frontmatter fence visible instead of eating the note', () => {
    const text = '--- date: 2026-07-07 broken note without closing fence'
    expect(plainNoteText(text)).toBe(text)
  })

  it('preserves line breaks and drops blank-line runs', () => {
    expect(plainNoteText('first\n\n\nsecond\nthird')).toBe('first\nsecond\nthird')
  })

  it('keeps hashtags (no space after #) untouched', () => {
    expect(plainNoteText('idea for #novel and #polish')).toBe('idea for #novel and #polish')
  })

  it('displays the alias of [[target|alias]] wikilinks', () => {
    expect(parseNoteText('see [[notes/2026-07-04|Friday note]]')[0]?.segments).toEqual([
      { text: 'see ', wikilink: false },
      { text: 'Friday note', wikilink: true },
    ])
  })

  it('strips bold marks but keeps stray single asterisks', () => {
    expect(plainNoteText('**bold** and 2*3 stays')).toBe('bold and 2*3 stays')
  })

  it('marks - and * list items as bullets', () => {
    const lines = parseNoteText('- one\n* two')
    expect(lines.map((l) => l.bullet)).toEqual([true, true])
    expect(plainNoteText('- one\n* two')).toBe('one\ntwo')
  })

  it('passes clean text through unchanged', () => {
    const clean = 'Sauna with Theo’s group — confirm by Wednesday'
    expect(plainNoteText(clean)).toBe(clean)
  })

  it('turns [label](https://…) markdown links into label segments with the href', () => {
    expect(parseNoteText('see [the doc](https://example.com/x?y=1) today')[0]?.segments).toEqual([
      { text: 'see ', wikilink: false },
      { text: 'the doc', wikilink: false, href: 'https://example.com/x?y=1' },
      { text: ' today', wikilink: false },
    ])
  })

  it('passes markdown links with non-http schemes through as plain text', () => {
    const js = 'click [here](javascript:alert(1)) now'
    expect(plainNoteText(js)).toBe(js)
    expect(parseNoteText(js).flatMap((l) => l.segments).some((s) => s.href !== undefined)).toBe(
      false,
    )
    const data = 'open [this](data:text/html,hi) later'
    expect(plainNoteText(data)).toBe(data)
    expect(parseNoteText(data).flatMap((l) => l.segments).some((s) => s.href !== undefined)).toBe(
      false,
    )
  })

  it('compresses bare URLs to their clickable domain', () => {
    expect(
      parseNoteText('read https://news.example.com/articles/2026/07/long-slug?utm=1 tonight')[0]
        ?.segments,
    ).toEqual([
      { text: 'read ', wikilink: false },
      {
        text: 'news.example.com',
        wikilink: false,
        href: 'https://news.example.com/articles/2026/07/long-slug?utm=1',
      },
      { text: ' tonight', wikilink: false },
    ])
  })

  it('keeps sentence punctuation after a bare URL out of the link', () => {
    expect(parseNoteText('details at https://example.com/page.')[0]?.segments).toEqual([
      { text: 'details at ', wikilink: false },
      { text: 'example.com', wikilink: false, href: 'https://example.com/page' },
      { text: '.', wikilink: false },
    ])
  })
})
