// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { autoGrowTextarea, composerRightAction } from './composerLayout'

describe('composerRightAction', () => {
  it('shows Send the moment the field holds non-whitespace text', () => {
    expect(composerRightAction('hi', true)).toBe('send')
    expect(composerRightAction('hi', false)).toBe('send')
  })

  it('shows the mic on an empty field only when dictation is available', () => {
    expect(composerRightAction('', true)).toBe('mic')
    expect(composerRightAction('   \n ', true)).toBe('mic') // whitespace is empty
  })

  it('falls back to (disabled) Send when the field is empty and voice is off', () => {
    expect(composerRightAction('', false)).toBe('send')
    expect(composerRightAction('\t', false)).toBe('send')
  })
})

describe('autoGrowTextarea', () => {
  it('is a no-op on a null ref', () => {
    expect(() => autoGrowTextarea(null)).not.toThrow()
  })

  it('pins the height to the content scrollHeight', () => {
    const el = document.createElement('textarea')
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 140 })
    autoGrowTextarea(el)
    expect(el.style.height).toBe('140px')
  })

  it('resets to auto before measuring so the field can shrink back down', () => {
    // scrollHeight mirrors a real browser: when a tall height is pinned and the
    // content is short, it reports the pinned box — unless height is 'auto',
    // when it collapses to the content. Without the reset the field never shrinks.
    const el = document.createElement('textarea')
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

    el.value = 'a\nb\nc' // three lines → tall
    autoGrowTextarea(el)
    expect(el.style.height).toBe('80px')

    el.value = '' // back to one line → must shrink, not stay at 80px
    autoGrowTextarea(el)
    expect(el.style.height).toBe('40px')
  })
})
