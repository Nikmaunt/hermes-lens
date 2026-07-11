// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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
import type { AgentStatus } from '@/schemas'
import { TodayScreen } from './TodayScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

/*
 * The system-pulse line under the last Today section. Its contract: composed
 * only from data the screen already fetches — the today query, the cached
 * /api/status and the triage cron constant. Rendering it must never issue a
 * status request of its own.
 */

const emptyToday = {
  date: '2026-07-10',
  followUps: [],
  deadlines: [],
  agentActivity: [],
  inboxCount: 0,
  generatedAt: '2026-07-10T08:00:00+02:00',
}

const statusWithBackupAt = (at: string): AgentStatus => ({
  gateway: { alive: true, lastHeartbeat: '2026-07-11T08:00:00+02:00' },
  cronJobs: [],
  lastBackup: { at, sizeBytes: 1024, target: 'b2://hermes' },
  system: {
    diskUsedBytes: 1,
    diskTotalBytes: 2,
    ramUsedBytes: 1,
    ramTotalBytes: 2,
    uptimeSeconds: 0,
  },
  tokenSpend: { todayUsd: 0, monthUsd: 0 },
  generatedAt: '2026-07-11T08:00:00+02:00',
})

const daysAgoIso = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

async function renderTodayWithStatus(status: AgentStatus | null) {
  const kv = new MemoryKV()
  const cache = createEndpointCache(kv)
  // Pre-seed the persistent cache the way a Status-screen visit would.
  if (status !== null) await cache.write('mock:status', status)
  const getStatus = vi.fn().mockResolvedValue(status)
  const ds = {
    kind: 'mock',
    getStatus,
    getToday: () => Promise.resolve(emptyToday),
    getSomeday: () => Promise.resolve({ items: [], generatedAt: '2026-07-10T08:00:00+02:00' }),
  } as unknown as DataSource
  const value = {
    ds,
    cache,
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
  return { getStatus }
}

describe('Today system-pulse line', () => {
  it(
    'shows sync time, backup age and the next triage run in one muted line',
    { timeout: TEST_TIMEOUT },
    async () => {
      await renderTodayWithStatus(statusWithBackupAt(daysAgoIso(0)))

      const synced = await screen.findByText(/^Synced \d{2}:\d{2}/, undefined, { timeout: 5000 })
      expect(synced.textContent).toMatch(
        /^Synced \d{2}:\d{2} · backup today · next triage \d{2}:\d{2}$/,
      )
      // A quiet footer, not a control: plain text, no button role.
      expect(synced.tagName).toBe('P')
      const fresh = screen.getByText('backup today')
      expect(fresh.className).not.toContain('text-warn')
    },
  )

  it(
    'a backup older than a day wears the warn accent',
    { timeout: TEST_TIMEOUT },
    async () => {
      await renderTodayWithStatus(statusWithBackupAt(daysAgoIso(3)))

      const stale = await screen.findByText('backup 3d ago', undefined, { timeout: 5000 })
      expect(stale.className).toContain('text-warn')
    },
  )

  it(
    'never issues a status request of its own — the cached payload is the only source',
    { timeout: TEST_TIMEOUT },
    async () => {
      const { getStatus } = await renderTodayWithStatus(statusWithBackupAt(daysAgoIso(0)))

      await screen.findByText(/^Synced \d{2}:\d{2}/, undefined, { timeout: 5000 })
      expect(getStatus).not.toHaveBeenCalled()
    },
  )

  it(
    'with no cached status the backup fragment is simply absent',
    { timeout: TEST_TIMEOUT },
    async () => {
      const { getStatus } = await renderTodayWithStatus(null)

      const synced = await screen.findByText(/^Synced \d{2}:\d{2}/, undefined, { timeout: 5000 })
      expect(synced.textContent).toMatch(/^Synced \d{2}:\d{2} · next triage \d{2}:\d{2}$/)
      expect(getStatus).not.toHaveBeenCalled()
    },
  )
})
