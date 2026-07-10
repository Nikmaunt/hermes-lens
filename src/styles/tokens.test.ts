import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * WCAG 1.4.11 (non-text contrast) guard for the theme tokens. Interactive
 * control states — switch track/thumb, the accent on-state, the focus ring —
 * must stay ≥3:1 against what they sit on, in BOTH themes. The light theme
 * once shipped a white switch track on a white card; this test is why that
 * cannot happen again. The trailing snapshot pins the full token table so
 * any palette change is a deliberate, reviewed diff.
 */

const css = readFileSync(fileURLToPath(new URL('./global.css', import.meta.url)), 'utf8')

/** Extract `--hl-*: value` declarations from one selector block. */
function tokensOf(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, `selector ${selector} present in global.css`).toBeGreaterThanOrEqual(0)
  const block = css.slice(start, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const match of block.matchAll(/(--hl-[\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match
    if (name !== undefined && value !== undefined) out[name] = value.trim()
  }
  return out
}

function luminance(hex: string): number {
  expect(hex, `expected a 6-digit hex color, got "${hex}"`).toMatch(/^#[0-9a-f]{6}$/i)
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const themes = {
  dark: tokensOf(':root'),
  light: tokensOf('html.light'),
}

describe.each(Object.entries(themes))('%s theme control contrast', (name, t) => {
  const pair = (fg: string, bg: string) => contrast(t[fg] ?? '', t[bg] ?? '')

  it('switch off-track is visible on a card', () => {
    expect(pair('--hl-control-track', '--hl-surface')).toBeGreaterThanOrEqual(3)
  })

  it('switch thumb is visible on the off-track', () => {
    expect(pair('--hl-control-thumb', '--hl-control-track')).toBeGreaterThanOrEqual(3)
  })

  it('switch on-track (accent) is visible on a card', () => {
    expect(pair('--hl-accent', '--hl-surface')).toBeGreaterThanOrEqual(3)
  })

  it('switch thumb (accent-ink) is visible on the on-track', () => {
    expect(pair('--hl-accent-ink', '--hl-accent')).toBeGreaterThanOrEqual(3)
  })

  it('active chip fill (accent) is visible on the page background', () => {
    expect(pair('--hl-accent', '--hl-bg')).toBeGreaterThanOrEqual(3)
  })

  it('focus ring (accent) is visible on background, card and raised', () => {
    expect(pair('--hl-accent', '--hl-bg')).toBeGreaterThanOrEqual(3)
    expect(pair('--hl-accent', '--hl-surface')).toBeGreaterThanOrEqual(3)
    expect(pair('--hl-accent', '--hl-raised')).toBeGreaterThanOrEqual(3)
  })

  it('accent action chip (Done) reads on a card, its label reads on the fill', () => {
    expect(pair('--hl-accent', '--hl-surface')).toBeGreaterThanOrEqual(3)
    expect(pair('--hl-accent-ink', '--hl-accent')).toBeGreaterThanOrEqual(3)
  })

  // Disabled controls are exempt from 1.4.11; the app dims them with
  // opacity-50 on top of these already-passing enabled states.

  it(`${name} token table matches the reviewed snapshot`, () => {
    expect(t).toMatchSnapshot()
  })
})
