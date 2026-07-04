import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useQueryClient } from '@tanstack/react-query'
import { useSettings } from '@/settings/SettingsProvider'
import { ApiDataSource } from './ApiDataSource'
import type { DataSource } from './DataSource'
import { MockDataSource } from './MockDataSource'
import { createEndpointCache, type EndpointCache } from './cache'
import { preferencesKV } from './kv'
import { createMutationQueue, type MutationQueue } from './mutationQueue'

interface DataContextValue {
  ds: DataSource
  cache: EndpointCache
  queue: MutationQueue
  /** Number of offline-queued mutations, live. */
  pendingCount: number
}

const DataContext = createContext<DataContextValue | null>(null)

const cache = createEndpointCache(preferencesKV)
const queue = createMutationQueue(preferencesKV)

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const { settings, apiToken } = useSettings()
  const queryClient = useQueryClient()
  const [pendingCount, setPendingCount] = useState(0)

  const ds = useMemo<DataSource>(() => {
    if (settings.source === 'api' && settings.apiBaseUrl !== '') {
      return new ApiDataSource(settings.apiBaseUrl, apiToken)
    }
    return new MockDataSource(preferencesKV)
  }, [settings.source, settings.apiBaseUrl, apiToken])

  useEffect(() => {
    void queue.count().then(setPendingCount)
    return queue.onCountChange(setPendingCount)
  }, [])

  // Drain the offline queue whenever the app returns to the foreground,
  // then refetch so optimistic state converges with the source of truth.
  useEffect(() => {
    const drain = () => {
      void queue.drain(ds).then((flushed) => {
        if (flushed > 0) void queryClient.invalidateQueries()
      })
    }
    drain()
    if (!Capacitor.isNativePlatform()) return
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) drain()
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [ds, queryClient])

  const value = useMemo(
    () => ({ ds, cache, queue, pendingCount }),
    [ds, pendingCount],
  )
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (ctx === null) throw new Error('useData outside DataSourceProvider')
  return ctx
}
