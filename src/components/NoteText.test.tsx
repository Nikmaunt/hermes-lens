// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NoteText } from './NoteText'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

describe('NoteText', () => {
  it('renders markdown links as anchors labeled with the text, URL hidden', () => {
    render(<NoteText text="see [the doc](https://example.com/deep/path) today" />)
    const a = screen.getByRole('link', { name: 'the doc' })
    expect(a).toHaveAttribute('href', 'https://example.com/deep/path')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    // The raw URL never shows in the visible text.
    expect(screen.queryByText(/example\.com\/deep/)).toBeNull()
  })

  it('never renders an anchor for javascript: links — literal text instead', () => {
    render(<NoteText text="click [here](javascript:alert(1)) now" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/javascript:alert/)).toBeInTheDocument()
  })

  it('shows bare URLs as their clickable domain', () => {
    render(<NoteText text="read https://news.example.com/a/very/long/path?utm=x tonight" />)
    const a = screen.getByRole('link', { name: 'news.example.com' })
    expect(a).toHaveAttribute('href', 'https://news.example.com/a/very/long/path?utm=x')
    expect(a).toHaveAttribute('target', '_blank')
  })

  it('wraps long unbroken tokens instead of overflowing horizontally', () => {
    const token = 'x'.repeat(200)
    const { container } = render(<NoteText text={`start ${token} end`} />)
    const root = container.firstElementChild as HTMLElement
    // Structural guard: the container itself opts into wrapping (break-words)
    // and may shrink inside flex parents (min-w-0) — jsdom cannot measure
    // layout, so the classes are the contract.
    expect(root.className).toContain('break-words')
    expect(root.className).toContain('min-w-0')
    // The 200-char token renders inline, with no overflow shell around it.
    expect(screen.getByText(new RegExp(token))).toBeInTheDocument()
    expect(container.querySelector('[class*="overflow-x"]')).toBeNull()
  })
})
