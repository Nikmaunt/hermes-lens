import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useData } from '@/data/DataSourceProvider'
import type { CaptureRequest, FlagAction, SyncAckRequest, TriageDestination } from '@/schemas'

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
