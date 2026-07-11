// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, type ReactNode } from 'react'
import { NotifBridge } from '@/features/notifications/notifBridge'
import type { BufferedNotification } from '@/features/notifications/notifBridge'
import { stableClientId } from '@/features/notifications/notifDrain'
import { createAppQueryClient } from '@/queryClient'
import { SettingsProvider, useSettings } from '@/settings/SettingsProvider'
import { DataSourceProvider, useData } from './DataSourceProvider'
import { MockDataSource } from './MockDataSource'
import { preferencesKV } from './kv'
import type { MutationQueue, QueuedMutation } from './mutationQueue'

// The provider drains the native buffer on mount/foreground; these tests
// model the native side: consumeBuffered returns everything not yet acked,
// ackBuffered drops entries up to the given id.
const bridgeState = vi.hoisted(() => ({
  pending: [] as { id: string; package: string; postedAt: string; capturedAt: string; title: string; text: string }[],
}))
vi.mock('@/features/notifications/notifBridge', () => ({
  NotifBridge: {
    consumeBuffered: vi.fn(() => Promise.resolve({ items: [...bridgeState.pending] })),
    ackBuffered: vi.fn(({ upToId }: { upToId: string }) => {
      const idx = bridgeState.pending.findIndex((item) => item.id === upToId)
      if (idx !== -1) bridgeState.pending = bridgeState.pending.slice(idx + 1)
      return Promise.resolve()
    }),
  },
}))

// Native platform, so the appStateChange listener registers; the captured
// callbacks let tests simulate foregrounds.
const capApp = vi.hoisted(() => ({
  listeners: [] as ((state: { isActive: boolean }) => void)[],
  removed: 0,
}))
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>()
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } }
})
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_event: string, cb: (state: { isActive: boolean }) => void) => {
      capApp.listeners.push(cb)
      return Promise.resolve({
        remove: () => {
          capApp.removed++
        },
      })
    },
  },
}))

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// The provider and queue share module-level state persisted in Preferences
// (jsdom localStorage) — every test starts from an empty slate.
beforeEach(async () => {
  await preferencesKV.remove('settings')
  await preferencesKV.remove('mutation-queue')
  await preferencesKV.remove('mutation-dead-letter')
  bridgeState.pending = []
  capApp.listeners = []
  capApp.removed = 0
  vi.clearAllMocks()
})

const seedSettings = (patch: Record<string, unknown>) =>
  preferencesKV.set('settings', JSON.stringify({ source: 'mock', configured: true, ...patch }))

const bufferedItem = (id: string): BufferedNotification => ({
  id,
  package: 'com.whatsapp',
  postedAt: '2026-07-11T09:30:00+02:00',
  capturedAt: '2026-07-11T09:30:02+02:00',
  title: 'Sender',
  text: 'message',
})

/** App.tsx renders DataSourceProvider only once settings are loaded. */
function Ready({ children }: { children: ReactNode }) {
  const { ready } = useSettings()
  return ready ? children : null
}

function renderProvider(children: ReactNode = null) {
  return render(
    <QueryClientProvider client={createAppQueryClient()}>
      <SettingsProvider>
        <Ready>
          <DataSourceProvider>{children}</DataSourceProvider>
        </Ready>
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

const queuedCapture: QueuedMutation = {
  id: 'q1',
  kind: 'capture',
  source: 'mock',
  enqueuedAt: new Date().toISOString(),
  req: { text: 'note 1', tags: [] },
}

describe('foreground drain chain', () => {
  it('catches a failing queue.drain — broken storage must not surface as an unhandled rejection', async () => {
    // The drain flushes an item, then fails to persist the emptied queue
    // (kv.set rejects). queue.drain() rejects; the foreground chain in
    // DataSourceProvider must catch that, not leak it to the runtime.
    await preferencesKV.set('mutation-queue', JSON.stringify([queuedCapture]))
    const realSet = preferencesKV.set.bind(preferencesKV)
    const setSpy = vi
      .spyOn(preferencesKV, 'set')
      .mockImplementation((key: string, value: string) =>
        key === 'mutation-queue' ? Promise.reject(new Error('disk full')) : realSet(key, value),
      )

    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onRejection)
    try {
      renderProvider()
      // The drain ran as far as saving the queue back…
      await waitFor(() =>
        expect(setSpy.mock.calls.some(([key]) => key === 'mutation-queue')).toBe(true),
      )
      // …and its rejection had time to either be caught or go unhandled.
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      process.off('unhandledRejection', onRejection)
    }
    expect(rejections).toEqual([])
  })
})

/** Grabs the module-level queue the provider actually uses. */
let queueRef: MutationQueue | null = null
function QueueProbe() {
  const { queue } = useData()
  useEffect(() => {
    queueRef = queue
  }, [queue])
  return null
}

/** Lets tests flip the data source like the Settings screen would. */
function SourceSwitch() {
  const { update } = useSettings()
  return (
    <button onClick={() => update({ source: 'api', apiBaseUrl: 'http://agent.test' })}>
      switch to api
    </button>
  )
}

describe('foreground reattach seam', () => {
  it('moves the native buffer into the queue BEFORE draining — a buffered notification rides the same foreground', async () => {
    await seedSettings({ notificationCaptureEnabled: true })
    bridgeState.pending = [bufferedItem('buf-1')]
    const sent = vi
      .spyOn(MockDataSource.prototype, 'captureNotification')
      .mockResolvedValue({ status: 'ok', itemId: 'm-1' })

    renderProvider(<QueueProbe />)

    // Delivered by the mount drain itself, not left waiting for the next one.
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1))
    expect(sent.mock.calls[0]?.[0]?.clientId).toBe(stableClientId('buf-1'))
    expect(vi.mocked(NotifBridge.ackBuffered)).toHaveBeenCalledWith({ upToId: 'buf-1' })
    await waitFor(async () => expect(await queueRef?.count()).toBe(0))
  })

  it('reattaches on a data-source switch: old listener removed, new drain runs against the new source', async () => {
    await seedSettings({ notificationCaptureEnabled: true })
    renderProvider(<SourceSwitch />)

    await waitFor(() => expect(vi.mocked(NotifBridge.consumeBuffered)).toHaveBeenCalledTimes(1))
    expect(capApp.listeners).toHaveLength(1)

    await userEvent.click(screen.getByText('switch to api'))

    // The drain re-ran for the new ds and the foreground listener was
    // re-registered (the stale one removed) — the seam follows the source.
    await waitFor(() => expect(vi.mocked(NotifBridge.consumeBuffered)).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(capApp.listeners).toHaveLength(2))
    await waitFor(() => expect(capApp.removed).toBe(1))
  })

  it('two rapid foregrounds deliver each buffered notification exactly once', async () => {
    await seedSettings({ notificationCaptureEnabled: true })
    const sent = vi
      .spyOn(MockDataSource.prototype, 'captureNotification')
      .mockResolvedValue({ status: 'ok', itemId: 'm-1' })

    renderProvider(<QueueProbe />)
    await waitFor(() => expect(vi.mocked(NotifBridge.consumeBuffered)).toHaveBeenCalledTimes(1))

    // A notification arrives while backgrounded; the user then flaps the
    // app to the foreground twice in quick succession.
    bridgeState.pending = [bufferedItem('buf-9')]
    const foreground = capApp.listeners.at(-1)
    expect(foreground).toBeDefined()
    act(() => {
      foreground?.({ isActive: true })
      foreground?.({ isActive: true })
    })

    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sent).toHaveBeenCalledTimes(1) // no duplicate enqueue, no double send
    await waitFor(async () => expect(await queueRef?.count()).toBe(0))
  })
})
