/**
 * Pure layout helpers for the chat composer (kept out of the component so the
 * icon-swap and auto-grow decisions are unit-testable without a DOM harness).
 */

export type ComposerAction = 'send' | 'mic'

/**
 * The single contextual control on the right of the field (ChatGPT pattern):
 * the moment there is text to send, it is Send; an empty field offers the mic
 * when dictation is available, otherwise a (disabled) Send so the slot never
 * goes empty.
 */
export function composerRightAction(text: string, voiceAvailable: boolean): ComposerAction {
  if (text.trim() !== '') return 'send'
  return voiceAvailable ? 'mic' : 'send'
}

/**
 * Grow a textarea to fit its content. Reset to 'auto' first so scrollHeight
 * reports the true content height rather than the previously pinned (taller)
 * box — without the reset the field grows but never shrinks. CSS max-height
 * caps the result and switches on the internal scroll past that.
 */
export function autoGrowTextarea(el: HTMLTextAreaElement | null): void {
  if (el === null) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
