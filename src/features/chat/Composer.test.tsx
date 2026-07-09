// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './ChatScreen'

afterEach(cleanup)

/**
 * jsdom does no layout, so scrollHeight is always 0. Mirror a real browser:
 * report the content height, but the pinned box when a taller height is held
 * and not reset — this is exactly the case autoGrowTextarea's reset addresses.
 */
function stubAutoHeight(el: HTMLTextAreaElement): void {
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      const lines = this.value === '' ? 1 : this.value.split('\n').length
      const content = 20 + lines * 20
      if (this.style.height === 'auto') return content
      const pinned = Number.parseInt(this.style.height, 10) || 0
      return Math.max(content, pinned)
    },
  })
}

const field = (): HTMLTextAreaElement =>
  screen.getByPlaceholderText<HTMLTextAreaElement>('Ask Hermes…')

describe('Composer', () => {
  it('keeps Send disabled until the field has text, then sends and clears', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} disabled={false} onNotice={() => {}} />)
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()

    fireEvent.change(field(), { target: { value: 'hello' } })
    expect(send).toBeEnabled()

    fireEvent.click(send)
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(field().value).toBe('')
  })

  it('never sends while a turn is running (disabled)', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} disabled onNotice={() => {}} />)
    fireEvent.change(field(), { target: { value: 'hello' } })
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends on Enter but Shift+Enter is left to insert a newline', () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} disabled={false} onNotice={() => {}} />)
    fireEvent.change(field(), { target: { value: 'hey' } })

    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hey')
  })

  it('grows the field for multi-line input and shrinks it back when cleared', () => {
    render(<Composer onSend={() => {}} disabled={false} onNotice={() => {}} />)
    const el = field()
    stubAutoHeight(el)

    fireEvent.change(el, { target: { value: 'a\nb\nc\nd' } }) // four lines
    expect(el.style.height).toBe('100px')

    fireEvent.change(el, { target: { value: 'a' } }) // one line → must shrink
    expect(el.style.height).toBe('40px')
  })

  it('is a plain bottom bar, not a sticky-positioned box (Fix A layout)', () => {
    // Fix A makes /chat a fixed-height column whose message list is the only
    // scroller; the composer must be an ordinary flex child, not sticky —
    // else a bottom overscroll drags it off the fixed BottomNav (the gap this
    // fix removes). jsdom applies no CSS, so lock the contract at the class /
    // inline-style level.
    const { container } = render(<Composer onSend={() => {}} disabled={false} onNotice={() => {}} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toMatch(/\bsticky\b/)
    expect(root.style.bottom).toBe('')
  })
})
