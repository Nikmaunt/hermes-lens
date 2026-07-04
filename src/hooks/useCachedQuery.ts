import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ApiError, type ApiErrorKind } from '@/data/ApiDataSource'
import { useData } from '@/data/DataSourceProvider'

export type QueryErrorKind = ApiErrorKind | 'unknown'

interface CachedResult<T> {
  data: T
  /** When this payload was successfully fetched from the source. */
  fetchedAt: string
  /** Kind of the most recent failed (re)fetch; null while the data is live. */
  errorKind: QueryErrorKind | null
}

function kindOf(err: unknown): QueryErrorKind {
  return err instanceof ApiError ? err.kind : 'unknown'
}

/** Background revalidations in flight, deduped per cache key. */
const inflight = new Map<string, Promise<void>>()

/**
 * Stale-while-revalidate over the persistent last-good-payload cache (F2):
 * when a cached payload exists it is served instantly — a dead Tailscale
 * route can no longer block the UI — and a background revalidation updates
 * the query when (and if) the agent answers. Only a cold cache blocks on the
 * network. Failures surface as `errorKind` + `staleSince` so screens can
 * explain what is wrong instead of showing a generic error.
 */
export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>) {
  const { ds, cache } = useData()
  const queryClient = useQueryClient()
  const cacheKey = `${ds.kind}:${key}`
  const queryKey = [ds.kind, key]

  const revalidate = useCallback((): Promise<void> => {
    let job = inflight.get(cacheKey)
    if (job === undefined) {
      job = (async () => {
        try {
          const data = await fetcher()
          await cache.write(cacheKey, data)
          queryClient.setQueryData<CachedResult<T>>(queryKey, {
            data,
            fetchedAt: new Date().toISOString(),
            errorKind: null,
          })
        } catch (err) {
          // Keep whatever is on screen; just mark it stale with the cause.
          queryClient.setQueryData<CachedResult<T>>(queryKey, (prev) =>
            prev === undefined ? prev : { ...prev, errorKind: kindOf(err) },
          )
        } finally {
          inflight.delete(cacheKey)
        }
      })()
      inflight.set(cacheKey, job)
    }
    return job
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey identity is derived from ds.kind+key
  }, [cacheKey, fetcher, cache, queryClient, ds.kind, key])

  const query = useQuery<CachedResult<T>>({
    queryKey,
    queryFn: async (): Promise<CachedResult<T>> => {
      const cached = await cache.read<T>(cacheKey)
      if (cached !== null) {
        // Warm cache: serve it now, refresh in the background.
        void revalidate()
        return { data: cached.payload, fetchedAt: cached.fetchedAt, errorKind: null }
      }
      // Cold cache: nothing to show — block on the network once.
      const data = await fetcher()
      await cache.write(cacheKey, data)
      return { data, fetchedAt: new Date().toISOString(), errorKind: null }
    },
    staleTime: 30_000,
    retry: 0,
  })

  const refetch = useCallback(async () => {
    await revalidate()
  }, [revalidate])

  const errorKind: QueryErrorKind | null =
    query.data?.errorKind ?? (query.error !== null ? kindOf(query.error) : null)

  return {
    data: query.data?.data,
    /** Non-null when cached data is shown and the source is failing. */
    staleSince: query.data !== undefined && errorKind !== null ? query.data.fetchedAt : null,
    errorKind,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error,
    refetch,
  }
}
