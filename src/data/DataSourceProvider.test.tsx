// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppQueryClient } from '@/queryClient'
import { SettingsProvider, useSettings } from '@/settings/SettingsProvider'
import { DataSourceProvider } from './DataSourceProvider'
import { preferencesKV } from './kv'
import type { QueuedMutation } from './mutationQueue'

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
