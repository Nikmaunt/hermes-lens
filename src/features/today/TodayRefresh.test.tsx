// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SnackbarProvider } from '@/components/SnackbarProvider'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { TodayScreen } from './TodayScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

/*
 * Pull-to-refresh on Today renews everything the screen surfaces — the today
 * payload, the someday section AND the briefs badge — not just /api/today.
 */

const emptyToday = {
  date: '2026-07-10',
  followUps: [],
  deadlines: [],
  agentActivity: [],
  inboxCount: 0,
  generatedAt: '2026-07-10T08:00:00+02:00',
}

function renderTodayWithSpies() {
  const getToday = vi.fn().mockResolvedValue(emptyToday)
  const getSomeday = vi
    .fn()
    .mockResolvedValue({ items: [], generatedAt: '2026-07-10T08:00:00+02:00' })
  const getBriefs = vi.fn().mockResolvedValue({ items: [] })
  const kv = new MemoryKV()
  const value = {
    ds: { kind: 'mock', getToday, getSomeday, getBriefs } as unknown as DataSource,
    cache: createEndpointCache(kv),
    queue: createMutationQueue(kv),
    pendingCount: 0,
    deadLetterCount: 0,
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <DataContext.Provider value={value}>
          <SnackbarProvider>
            <MemoryRouter initialEntries={['/']}>
              <TodayScreen />
            </MemoryRouter>
          </SnackbarProvider>
        </DataContext.Provider>
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { getToday, getSomeday, getBriefs }
}

/** Drag far enough past the 70px trigger (dy · 0.45 resistance). */
function pullToRefresh(target: Element) {
  fireEvent.touchStart(target, { touches: [{ clientY: 100 }] })
  fireEvent.touchMove(target, { touches: [{ clientY: 350 }] })
  fireEvent.touchEnd(target)
}

describe('Today pull-to-refresh', () => {
  it(
    'renews the today payload, the someday list and the briefs badge together',
    { timeout: TEST_TIMEOUT },
    async () => {
      const { getToday, getSomeday, getBriefs } = renderTodayWithSpies()

      // Initial load settles: one fetch per source.
      const inside = await screen.findByText('Nothing waiting on you. Rare.', undefined, {
        timeout: 5000,
      })
      await waitFor(() => {
        expect(getToday).toHaveBeenCalledTimes(1)
        expect(getSomeday).toHaveBeenCalledTimes(1)
        expect(getBriefs).toHaveBeenCalledTimes(1)
      })

      // Touch events bubble up from inside the PullToRefresh wrapper.
      pullToRefresh(inside)

      // One PTR → all three sources revalidate, not just /api/today.
      await waitFor(() => {
        expect(getToday).toHaveBeenCalledTimes(2)
        expect(getSomeday).toHaveBeenCalledTimes(2)
        expect(getBriefs).toHaveBeenCalledTimes(2)
      })
    },
  )
})
