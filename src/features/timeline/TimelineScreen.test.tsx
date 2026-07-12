// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'
import { SnackbarProvider } from '@/components/SnackbarProvider'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { TimelineResponse } from '@/schemas'
import { TimelineScreen } from './TimelineScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

async function bootToTimeline() {
  // jsdom keeps the URL across tests in a file; every boot starts from root.
  window.history.replaceState({}, '', '/')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
  await waitFor(
    () => {
      const demo = screen.queryByText('Try demo mode')
      const today = screen.queryByText('Open follow-ups')
      expect(demo ?? today).not.toBeNull()
    },
    { timeout: 5000 },
  )
  const demo = screen.queryByText('Try demo mode')
  if (demo !== null) await userEvent.click(demo)
  await userEvent.click(await screen.findByText('More', undefined, { timeout: 5000 }))
  await userEvent.click(await screen.findByText('Timeline', undefined, { timeout: 5000 }))
  await waitFor(
    () => expect(screen.getByText('Notification captured')).toBeInTheDocument(),
    { timeout: 5000 },
  )
}

describe('timeline event details', () => {
  it(
    'a notification (system) event expands details in place and never opens Status',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      const row = screen.getByRole('button', { name: /Notification captured/ })
      await userEvent.click(row)

      // Details unfold inside the row: type label and the related record id
      // (the id also sits in the collapsed detail line, hence getAllByText).
      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(within(row).getByText('System')).toBeInTheDocument()
      expect(within(row).getByText('Ref')).toBeInTheDocument()
      expect(
        within(row).getAllByText(/1751955060000-whatsapp-9f3a2b1c/).length,
      ).toBeGreaterThanOrEqual(1)

      // Still on the Timeline — the tap must not jump to Agent Status.
      expect(screen.getByRole('heading', { name: /Timeline/ })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Agent Status/ })).toBeNull()
      expect(screen.queryByText('Telegram gateway')).toBeNull()

      // A second tap folds the details back.
      await userEvent.click(row)
      expect(row).toHaveAttribute('aria-expanded', 'false')
      expect(within(row).queryByText('System')).toBeNull()
    },
  )

  it(
    'an agent event expands with the privacy note instead of a toast',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      const row = screen.getByRole('button', { name: /Morning brief sent/ })
      await userEvent.click(row)
      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(within(row).getByText(/privately/)).toBeInTheDocument()
    },
  )

  it(
    'capture events still navigate to the Inbox deep-link',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      await userEvent.click(
        screen.getByRole('button', { name: /Captured: landlord approval template idea/ }),
      )
      await waitFor(
        () => expect(screen.getByRole('heading', { name: /Inbox/ })).toBeInTheDocument(),
        { timeout: 5000 },
      )
    },
  )

  it(
    'a queued triage ack follows the item into the Inbox instead of expanding',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      const row = screen.getByRole('button', { name: /Inbox triage queued/ })
      // Navigational rows carry no expansion affordance.
      expect(row).not.toHaveAttribute('aria-expanded')
      await userEvent.click(row)
      await waitFor(
        () => expect(screen.getByRole('heading', { name: /Inbox/ })).toBeInTheDocument(),
        { timeout: 5000 },
      )
      expect(screen.queryByRole('heading', { name: /Timeline/ })).toBeNull()
    },
  )

  it(
    'a queued follow-up ack leads to Today, not Status',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      await userEvent.click(screen.getByRole('button', { name: /Follow-up action queued/ }))
      await waitFor(
        () => expect(screen.getByText('Open follow-ups')).toBeInTheDocument(),
        { timeout: 5000 },
      )
      expect(screen.queryByRole('heading', { name: /Agent Status/ })).toBeNull()
    },
  )
})

/** TimelineScreen with an injected data source, for payloads a newer sidecar sends. */
function renderTimelineWith(rawResponse: unknown) {
  const kv = new MemoryKV()
  const ds = {
    kind: 'mock',
    // Parse the raw payload exactly like ApiDataSource would — the test
    // covers the schema tolerance and the screen in one pass.
    getTimeline: async () => TimelineResponse.parse(rawResponse),
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
            <MemoryRouter initialEntries={['/timeline']}>
              <TimelineScreen />
            </MemoryRouter>
          </SnackbarProvider>
        </DataContext.Provider>
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

describe('contract evolution: a newer sidecar', () => {
  it(
    'an unknown category renders as a live system row instead of killing the screen',
    { timeout: TEST_TIMEOUT },
    async () => {
      renderTimelineWith({
        events: [
          {
            id: 'ev-exotic',
            at: '2026-07-11T09:00:00+02:00',
            category: 'finance', // this app version has never heard of it
            title: 'Ledger reconciled',
            detail: null,
            relatedId: null,
          },
        ],
        nextBefore: null,
      })

      // The screen is alive and the event is on it.
      const row = await screen.findByRole('button', { name: /Ledger reconciled/ }, { timeout: 5000 })
      expect(screen.getByRole('heading', { name: /Timeline/ })).toBeInTheDocument()

      // It behaves as a system event: expands in place, typed System.
      await userEvent.click(row)
      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(within(row).getByText('System')).toBeInTheDocument()
    },
  )

  it(
    'an unknown kind on a known category expands in place — the safe default',
    { timeout: TEST_TIMEOUT },
    async () => {
      renderTimelineWith({
        events: [
          {
            id: 'ev-kind',
            at: '2026-07-11T10:00:00+02:00',
            category: 'memory',
            title: 'Memory consolidated',
            detail: null,
            relatedId: 'mem-1',
            kind: 'memory-consolidated', // not in the kind table
          },
        ],
        nextBefore: null,
      })

      const row = await screen.findByRole('button', { name: /Memory consolidated/ }, { timeout: 5000 })
      await userEvent.click(row)
      // No navigation happened (the Timeline heading is still there) and the
      // row unfolded instead.
      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('heading', { name: /Timeline/ })).toBeInTheDocument()
    },
  )
})
