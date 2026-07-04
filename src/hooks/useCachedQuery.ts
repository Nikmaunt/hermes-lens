import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useData } from '@/data/DataSourceProvider'

interface CachedResult<T> {
  data: T
  /** Non-null when the live fetch failed and we fell back to the cache. */
  staleSince: string | null
}

/**
 * useQuery wrapped with the last-good-payload cache: successful responses are
 * persisted; on failure the cached payload is served with `staleSince` set so
 * screens can show a "stale since …" banner instead of an error.
 */
export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>) {
  const { ds, cache } = useData()
  const queryClient = useQueryClient()
  const cacheKey = `${ds.kind}:${key}`
  const queryKey = [ds.kind, key]

  const query = useQuery<CachedResult<T>>({
    queryKey,
    queryFn: async (): Promise<CachedResult<T>> => {
      try {
        const data = await fetcher()
        await cache.write(cacheKey, data)
        return { data, staleSince: null }
      } catch (err) {
        const cached = await cache.read<T>(cacheKey)
        if (cached !== null) return { data: cached.payload, staleSince: cached.fetchedAt }
        throw err
      }
    },
    staleTime: 30_000,
    retry: 1,
  })

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey identity is derived from ds.kind+key
  }, [queryClient, ds.kind, key])

  return {
    data: query.data?.data,
    staleSince: query.data?.staleSince ?? null,
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error,
    refetch,
  }
}
