// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { SnackbarProvider } from '@/components/SnackbarProvider'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { SettingsProvider } from '@/settings/SettingsProvider'
import type { AgentStatus } from '@/schemas'
import { StatusScreen } from './StatusScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const status: AgentStatus = {
  gateway: { alive: true, lastHeartbeat: '2026-07-11T08:00:00+02:00' },
  cronJobs: [],
  lastBackup: null,
  system: {
    diskUsedBytes: 1,
    diskTotalBytes: 2,
    ramUsedBytes: 1,
    ramTotalBytes: 2,
    uptimeSeconds: 0,
  },
  tokenSpend: { todayUsd: 0.42, monthUsd: 3.17 },
  generatedAt: '2026-07-11T08:00:00+02:00',
}

/** StatusScreen with an injected data source, for copy the fixtures can't pin. */
function renderStatus(overrides: Partial<AgentStatus> = {}) {
  const kv = new MemoryKV()
  const ds = {
    kind: 'mock',
    getStatus: async () => ({ ...status, ...overrides }),
  } as unknown as DataSource
  const value = {
    ds,
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
            <MemoryRouter initialEntries={['/status']}>
              <StatusScreen />
            </MemoryRouter>
          </SnackbarProvider>
        </DataContext.Provider>
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

describe('token spend caption', () => {
  it('labels the tracked figure honestly — no "this month" claim', { timeout: 20_000 }, async () => {
    renderStatus()
    // An older sidecar sends no tracking-start date, so the caption must not
    // pretend the figure covers the whole month.
    await screen.findByText('total tracked', undefined, { timeout: 5000 })
    expect(screen.queryByText('this month')).toBeNull()
    expect(screen.getByText('$3.17')).toBeInTheDocument()
    expect(screen.getByText('today')).toBeInTheDocument()
  })

  it('shows the tracking start when the sidecar reports since', { timeout: 20_000 }, async () => {
    renderStatus({ tokenSpend: { todayUsd: 0.42, monthUsd: 3.17, since: '12 Jun' } })
    await screen.findByText('since 12 Jun', undefined, { timeout: 5000 })
    expect(screen.queryByText('total tracked')).toBeNull()
    expect(screen.getByText('$3.17')).toBeInTheDocument()
  })
})
