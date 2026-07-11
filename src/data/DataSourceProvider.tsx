import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useQueryClient } from '@tanstack/react-query'
import { NotifBridge } from '@/features/notifications/notifBridge'
import { drainNotificationBuffer } from '@/features/notifications/notifDrain'
import { useSettings } from '@/settings/SettingsProvider'
import { ApiDataSource } from './ApiDataSource'
import { clearAuthFailure } from './authState'
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
  /** Number of permanently rejected mutations awaiting a user decision, live. */
  deadLetterCount: number
}

/** Exported for tests that inject a data source directly (bypassing the provider). */
export const DataContext = createContext<DataContextValue | null>(null)

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

  const [deadLetterCount, setDeadLetterCount] = useState(0)

  useEffect(() => {
    void queue.count().then(setPendingCount)
    return queue.onCountChange(setPendingCount)
  }, [])

  useEffect(() => {
    void queue.deadLetters().then((dead) => setDeadLetterCount(dead.length))
    return queue.onDeadLetterChange(setDeadLetterCount)
  }, [])

  // A new source (or an edited token) deserves a clean slate for the
  // auth-failure banner — the next request re-reports if still rejected.
  useEffect(() => {
    clearAuthFailure()
  }, [ds])

  // Drain the offline queue whenever the app returns to the foreground,
  // then refetch so optimistic state converges with the source of truth.
  // The native notification buffer moves into the queue first, so its items
  // ride the same drain (fail-open: the web mock answers an empty buffer).
  const notifEnabled = settings.notificationCaptureEnabled
  useEffect(() => {
    const drain = () => {
      void drainNotificationBuffer({
        bridge: NotifBridge,
        queue,
        source: ds.kind,
        enabled: notifEnabled,
      })
        .catch(() => 0) // enqueue failed (broken storage) — buffer keeps the items for next drain
        .then(() => queue.drain(ds))
        .then((flushed) => {
          if (flushed > 0) void queryClient.invalidateQueries()
        })
        // queue.drain rejects only on storage failures (send errors are
        // handled inside): the items stay queued for the next foreground,
        // and the rejection must never leak unhandled out of the chain.
        .catch(() => undefined)
    }
    drain()
    if (!Capacitor.isNativePlatform()) return
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) drain()
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [ds, queryClient, notifEnabled])

  const value = useMemo(
    () => ({ ds, cache, queue, pendingCount, deadLetterCount }),
    [ds, pendingCount, deadLetterCount],
  )
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (ctx === null) throw new Error('useData outside DataSourceProvider')
  return ctx
}
