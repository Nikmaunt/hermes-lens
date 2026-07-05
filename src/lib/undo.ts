import type { MutationQueue, QueuedMutation } from '@/data/mutationQueue'

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
 *
 * The queue is inspected here, at tap time — never in the caller's closure:
 * a snackbar's onAction is created before the offline path enqueues the
 * mutation, so a captured queue snapshot would miss it.
 */
export async function undoAction(
  queue: MutationQueue,
  match: (m: QueuedMutation) => boolean,
  sendUndo: () => Promise<{ gone: boolean }>,
): Promise<UndoOutcome> {
  const queued = (await queue.peek()).find(match)
  if (queued !== undefined && (await queue.remove(queued.id))) {
    return { dequeued: true, gone: false }
  }
  const { gone } = await sendUndo()
  return { dequeued: false, gone }
}
