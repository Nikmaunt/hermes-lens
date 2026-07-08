import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useData } from '@/data/DataSourceProvider'
import {
  CHAT_TURN_BUDGET_MS,
  chatPollInterval,
  chatTurnView,
  type ChatPollSnapshot,
  type ChatTurnView,
} from './chatTurn'

/**
 * Polls one chat turn to a terminal state via TanStack's native
 * refetchInterval — deliberately NOT useCachedQuery: a chat job must never
 * touch the persistent endpoint cache, or a stale job would resurface on the
 * next boot (D-A5). gcTime/staleTime 0 keeps the job out of any cache too.
 *
 * `jobId` null disables the query — nothing is in flight. `startedAtMs` anchors
 * the per-turn budget; when null (no active turn) the budget is not armed.
 * The caller ignores the returned view while there is no active turn.
 */
export function useChatJobPoll(jobId: string | null, startedAtMs: number | null): ChatTurnView {
  const { ds } = useData()

  // Force one render at the budget deadline: if the last poll left the job
  // running, refetchInterval stops but nothing else would re-render to flip the
  // view to "timed out". This timer does (D-A5).
  const [, tick] = useState(0)
  useEffect(() => {
    if (jobId === null || startedAtMs === null) return
    const remaining = startedAtMs + CHAT_TURN_BUDGET_MS - Date.now()
    if (remaining <= 0) return
    const t = setTimeout(() => tick((n) => n + 1), remaining)
    return () => clearTimeout(t)
  }, [jobId, startedAtMs])

  const query = useQuery({
    queryKey: ['chat-job', jobId],
    enabled: jobId !== null,
    queryFn: () => ds.getChatJob(jobId as string),
    retry: 0,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: (q) =>
      chatPollInterval({
        data: q.state.data,
        error: q.state.error,
        elapsedMs: elapsedSince(startedAtMs),
      }),
  })

  const snapshot: ChatPollSnapshot = {
    data: query.data,
    error: query.error,
    elapsedMs: elapsedSince(startedAtMs),
  }
  return chatTurnView(snapshot)
}

function elapsedSince(startedAtMs: number | null): number {
  return startedAtMs === null ? 0 : Date.now() - startedAtMs
}
