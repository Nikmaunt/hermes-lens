import type { MutationQueue } from '@/data/mutationQueue'

export interface UndoOutcome {
  /** The original mutation was withdrawn from the local queue — nothing was ever sent. */
  dequeued: boolean
  /** The server had nothing left to cancel: the agent already processed the action. */
  gone: boolean
}

/**
 * Undo an optimistic action. If the original mutation is still waiting in
 * the local queue it is withdrawn without touching the network; otherwise
 * (already sent, or a drain raced the tap) the undo itself is sent.
 */
export async function undoAction(
  queue: MutationQueue,
  queuedId: string | undefined,
  sendUndo: () => Promise<{ gone: boolean }>,
): Promise<UndoOutcome> {
  if (queuedId !== undefined && (await queue.remove(queuedId))) {
    return { dequeued: true, gone: false }
  }
  const { gone } = await sendUndo()
  return { dequeued: false, gone }
}
