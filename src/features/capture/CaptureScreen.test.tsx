// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { App } from '../../App'

// Read the stylesheet source directly: vitest stubs CSS imports (even ?raw),
// and jsdom does not implement cascade layers, so the layering contract can
// only be asserted against the source text.
const globalCss = readFileSync('src/styles/global.css', 'utf8')

/**
 * Capture screen visual-contract test: exactly one focus treatment on the
 * textarea (the accent border — the global :focus-visible ring is opted out),
 * an unambiguous disabled state on the send button, and no mic button in
 * environments without a native recognizer.
 */
describe('CaptureScreen', () => {
  it('has a single focus treatment and a clear disabled send state', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    const demoButton = await screen.findByText('Try demo mode', undefined, { timeout: 5000 })
    await userEvent.click(demoButton)
    await waitFor(() => expect(screen.getByText('Open follow-ups')).toBeInTheDocument(), {
      timeout: 5000,
    })

    const captureLink = container.querySelector('a[href="/capture"]')
    expect(captureLink).not.toBeNull()
    await userEvent.click(captureLink as Element)

    const textarea = await screen.findByPlaceholderText("What's on your mind?")
    // One focus treatment: accent border on focus, global focus-visible ring
    // suppressed — otherwise both stack into a doubled gold outline.
    expect(textarea.className).toContain('focus:border-accent')
    expect(textarea.className).toContain('focus-visible:outline-none')
    expect(textarea.className.match(/focus/g)).toHaveLength(2)
    // No wrapper may add a second border/ring/outline around the textarea.
    for (let el = textarea.parentElement; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/(?:^|[\s:])(?:border|ring|outline)(?:-|\b)|focus/)
    }
    // The opt-out only wins if the global ring is layered: unlayered CSS beats
    // @layer utilities regardless of specificity, and text fields match
    // :focus-visible even on touch — the exact doubled-frame bug on device.
    const baseLayer = globalCss.match(/@layer base\s*\{[\s\S]*?:focus-visible/)
    expect(baseLayer).not.toBeNull()
    const unlayeredRing = globalCss.replace(/@layer base\s*\{[\s\S]*?\n\}/g, '')
    expect(unlayeredRing).not.toMatch(/^\s*:focus-visible\s*\{/m)

    // Disabled send: distinct muted surface, not a translucent accent.
    const send = screen.getByRole('button', { name: 'Send to Hermes' })
    expect(send).toBeDisabled()
    expect(send.className).toContain('disabled:bg-raised')
    expect(send.className).toContain('disabled:text-faint')
    expect(send.className).not.toContain('disabled:opacity')

    // No recognizer in jsdom: the mic must be hidden, typing still works.
    expect(screen.queryByLabelText('Dictate a note')).toBeNull()

    await userEvent.type(textarea, 'note')
    expect(send).toBeEnabled()
  })
})
