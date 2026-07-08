import type { ChatErrorReason, ChatTurnView } from './chatTurn'

/**
 * The pending bubble — the single turn that is not yet in the transcript.
 * Pure mapping of the controller's state (POST in flight / accepted+polling /
 * failed) to what the screen draws, so every bubble state is unit-testable
 * without a DOM (D-A10).
 */
export interface PendingTurn {
  userMessage: string
  status: 'sending' | 'thinking' | 'done' | 'error'
  reply: string | null
  tokensUsed: number | null
  errorReason: ChatErrorReason | null
  errorMessage: string | null
}

const base = (userMessage: string): PendingTurn => ({
  userMessage,
  status: 'sending',
  reply: null,
  tokensUsed: null,
  errorReason: null,
  errorMessage: null,
})

export function computePendingTurn(input: {
  sending: boolean
  sendError: ChatErrorReason | null
  attemptedMessage: string | null
  active: { userMessage: string } | null
  view: ChatTurnView
}): PendingTurn | null {
  const { sending, sendError, attemptedMessage, active, view } = input

  // An accepted turn (a jobId being polled) wins over any stale send state.
  if (active !== null) {
    if (view.phase === 'done') {
      return { ...base(active.userMessage), status: 'done', reply: view.reply, tokensUsed: view.tokensUsed }
    }
    if (view.phase === 'error') {
      return {
        ...base(active.userMessage),
        status: 'error',
        errorReason: view.reason,
        errorMessage: view.message,
      }
    }
    return { ...base(active.userMessage), status: 'thinking' }
  }

  // No accepted turn yet: the POST is either in flight or it failed (D-A9).
  if (attemptedMessage !== null) {
    if (sending) return base(attemptedMessage)
    if (sendError !== null) {
      return { ...base(attemptedMessage), status: 'error', errorReason: sendError }
    }
  }
  return null
}
