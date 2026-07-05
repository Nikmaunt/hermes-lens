import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useData } from '@/data/DataSourceProvider'
import type { QueuedMutation } from '@/data/mutationQueue'
import type {
  CaptureRequest,
  FlagAction,
  FollowupActionRequest,
  HabitTickRequest,
  SyncAckRequest,
  TriageDestination,
} from '@/schemas'

/**
 * Write actions share one failure policy: try the data source, and when it is
 * unreachable, enqueue the mutation for the next foreground retry. The UI
 * treats `queued: true` as success with an "will sync later" note.
 */
interface WriteResult {
  queued: boolean
}

export function useCapture() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<WriteResult, Error, CaptureRequest>({
    mutationFn: async (input) => {
      // One clientId per capture, minted before the first attempt and kept
      // through queue replays, so the server can dedup retries (F6).
      const req: CaptureRequest = { ...input, clientId: input.clientId ?? crypto.randomUUID() }
      try {
        await ds.capture(req)
        return { queued: false }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'capture',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          req,
        })
        return { queued: true }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'inbox'] })
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'today'] })
    },
  })
}

export function useTriage() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<WriteResult, Error, { itemId: string; destination: TriageDestination }>({
    mutationFn: async ({ itemId, destination }) => {
      try {
        await ds.triage(itemId, { destination })
        return { queued: false }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'triage',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          itemId,
          req: { destination },
        })
        return { queued: true }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'inbox'] })
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'today'] })
    },
  })
}

/**
 * Acknowledge an applied reminders revision, through the same
 * offline-queue policy as every other write: try now, queue on failure.
 * Idempotent server-side, so replays are harmless.
 */
export function useAckSync() {
  const { ds, queue } = useData()
  return useCallback(
    async (req: SyncAckRequest): Promise<void> => {
      try {
        await ds.ackSync(req)
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'ack-sync',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          req,
        })
      }
    },
    [ds, queue],
  )
}

/**
 * Result of a write whose 200 response can say "gone": the item vanished
 * server-side before the action arrived. That is success-by-staleness — the
 * caller quietly drops the item, never an error.
 */
interface StaleableWriteResult {
  queued: boolean
  gone: boolean
}

export function useFollowupAction() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<StaleableWriteResult, Error, { itemId: string; req: FollowupActionRequest }>({
    mutationFn: async ({ itemId, req }) => {
      try {
        const res = await ds.followupAction(itemId, req)
        return { queued: false, gone: res.status === 'gone' }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'followup-action',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          itemId,
          req,
        })
        return { queued: true, gone: false }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'today'] })
    },
  })
}

export function useHabitTick() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<StaleableWriteResult, Error, { itemId: string; req: HabitTickRequest }>({
    mutationFn: async ({ itemId, req }) => {
      try {
        const res = await ds.tickHabit(itemId, req)
        return { queued: false, gone: res.status === 'gone' }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'habit-tick',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          itemId,
          req,
        })
        return { queued: true, gone: false }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'habits'] })
    },
  })
}

export function useFollowupUndo() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<StaleableWriteResult, Error, { itemId: string }>({
    mutationFn: async ({ itemId }) => {
      try {
        const res = await ds.undoFollowupAction(itemId)
        return { queued: false, gone: res.status === 'gone' }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'followup-undo',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          itemId,
        })
        return { queued: true, gone: false }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'today'] })
    },
  })
}

export function useHabitUndo() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<StaleableWriteResult, Error, { itemId: string; req: HabitTickRequest }>({
    mutationFn: async ({ itemId, req }) => {
      try {
        const res = await ds.undoHabitTick(itemId, req)
        return { queued: false, gone: res.status === 'gone' }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'habit-undo',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          itemId,
          req,
        })
        return { queued: true, gone: false }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'habits'] })
    },
  })
}

export function useUntriage() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<StaleableWriteResult, Error, { itemId: string }>({
    mutationFn: async ({ itemId }) => {
      try {
        const res = await ds.untriage(itemId)
        return { queued: false, gone: res.status === 'gone' }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'untriage',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          itemId,
        })
        return { queued: true, gone: false }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'inbox'] })
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'today'] })
    },
  })
}

/**
 * Live view of the offline queue filtered to one mutation kind and the active
 * source — screens use it to draw queued actions exactly like server-side
 * pending ones, so optimistic state survives an app restart.
 */
export function useQueuedMutationsOf<K extends QueuedMutation['kind']>(
  kind: K,
): Extract<QueuedMutation, { kind: K }>[] {
  const { ds, queue } = useData()
  const [items, setItems] = useState<Extract<QueuedMutation, { kind: K }>[]>([])
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void queue.peek().then((all) => {
        if (!alive) return
        setItems(
          all.filter(
            (m): m is Extract<QueuedMutation, { kind: K }> =>
              m.kind === kind && m.source === ds.kind,
          ),
        )
      })
    }
    refresh()
    const unsubscribe = queue.onCountChange(refresh)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [queue, ds.kind, kind])
  return items
}

export function useFlagMemory() {
  const { ds, queue } = useData()
  const queryClient = useQueryClient()
  return useMutation<WriteResult, Error, { itemId: string; action: FlagAction; reason?: string }>({
    mutationFn: async ({ itemId, action, reason }) => {
      const req = reason === undefined ? { action } : { action, reason }
      try {
        await ds.flagMemory(itemId, req)
        return { queued: false }
      } catch {
        await queue.enqueue({
          id: crypto.randomUUID(),
          kind: 'flag',
          source: ds.kind,
          enqueuedAt: new Date().toISOString(),
          itemId,
          req,
        })
        return { queued: true }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ds.kind, 'memory'] })
    },
  })
}
