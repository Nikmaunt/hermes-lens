// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { snoozeTomorrow } from '@/lib/snooze'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { SomedayScreen } from './SomedayScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

// App boots (first-run gate + mock latency) make these slower than the 5 s default.
const TEST_TIMEOUT = 20_000

/*
 * The Someday screen, reached through More, against the demo data source.
 * Fixtures: sd-1 and sd-2 are actionable; sd-3 ships a server-side
 * pendingAction (like fu-6 on Today), so undoing it answers "gone".
 */

async function bootToSomeday() {
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
  await userEvent.click(await screen.findByText('Someday', undefined, { timeout: 5000 }))
  await waitFor(
    () =>
      expect(screen.getByText('Plan the Cascades hiking trip')).toBeInTheDocument(),
    { timeout: 5000 },
  )
}

describe('the Someday screen', () => {
  it(
    'lists parked items with title and source; a fixture pendingAction shows syncing with Undo',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSomeday()
      expect(screen.getByText('Research a standing desk for the home office')).toBeInTheDocument()
      expect(screen.getByText('telegram, parked from follow-ups')).toBeInTheDocument()

      // sd-3 ships pending from the fixtures: syncing card, no action buttons.
      const title = 'Digitize the old family photo albums'
      expect(screen.getByText(title).className).toContain('line-through')
      expect(screen.getAllByText('syncing').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: `Undo: ${title}` })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: `Close: ${title}` })).toBeNull()
      expect(screen.queryByRole('button', { name: `Activate: ${title}` })).toBeNull()
    },
  )

  it(
    'activate requires a date: hidden input min is tomorrow, past dates are ignored',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSomeday()
      const title = 'Plan the Cascades hiking trip'
      expect(screen.getByRole('button', { name: `Activate: ${title}` })).toBeInTheDocument()

      const input = screen.getByLabelText<HTMLInputElement>(`Activate date: ${title}`)
      expect(input.min).toBe(snoozeTomorrow())
      expect(input.className).toContain('sr-only')

      // A past date sneaking through the picker fires no mutation.
      fireEvent.change(input, { target: { value: '2020-01-01' } })
      expect(screen.getByText(title).className).not.toContain('line-through')
      expect(screen.getByRole('button', { name: `Close: ${title}` })).toBeInTheDocument()
    },
  )

  it(
    'activate with a picked date: syncing card, snackbar Undo restores it',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSomeday()
      const title = 'Plan the Cascades hiking trip'
      const input = screen.getByLabelText<HTMLInputElement>(`Activate date: ${title}`)
      fireEvent.change(input, { target: { value: input.min } })

      await waitFor(() => expect(screen.getByText(title).className).toContain('line-through'))
      expect(screen.getByText(/^activates on /)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: `Close: ${title}` })).toBeNull()

      // Snackbar arrives once the action settled; Undo restores the card.
      await screen.findByText(/^Activates on /, undefined, { timeout: 5000 })
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(
        () => expect(screen.getByRole('button', { name: `Close: ${title}` })).toBeInTheDocument(),
        { timeout: 5000 },
      )
      expect(screen.getByText(title).className).not.toContain('line-through')
      // Let the background undo request settle before the next boot reads the
      // overlay — later tests rely on sd-1 being clean.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    },
  )

  it(
    'close: syncing card, snackbar Undo restores it',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSomeday()
      const title = 'Research a standing desk for the home office'
      await userEvent.click(screen.getByRole('button', { name: `Close: ${title}` }))

      await waitFor(() => expect(screen.getByText(title).className).toContain('line-through'))
      expect(screen.queryByRole('button', { name: `Activate: ${title}` })).toBeNull()

      await screen.findByText('Closed', undefined, { timeout: 5000 })
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(
        () => expect(screen.getByRole('button', { name: `Close: ${title}` })).toBeInTheDocument(),
        { timeout: 5000 },
      )
      // Same overlay-settling wait as above before the next boot.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    },
  )

  it(
    'undo on a fixture pendingAction answers gone: the card drops with an explanation',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSomeday()
      // sd-3's queue file lives server-side, out of reach — undo answers gone.
      const title = 'Digitize the old family photo albums'
      await userEvent.click(screen.getByRole('button', { name: `Undo: ${title}` }))

      await screen.findByText('The agent already handled this item', undefined, { timeout: 5000 })
      expect(screen.queryByText(title)).toBeNull()
      // Informational only — no Undo action on this snackbar.
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    },
  )

  it(
    'shows the empty state when nothing is parked',
    { timeout: TEST_TIMEOUT },
    async () => {
      // Injected data source (the demo fixtures are never empty).
      const ds = {
        kind: 'mock',
        getSomeday: () =>
          Promise.resolve({ items: [], generatedAt: '2026-07-09T08:00:00+02:00' }),
      } as unknown as DataSource
      const kv = new MemoryKV()
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
                <MemoryRouter initialEntries={['/someday']}>
                  <SomedayScreen />
                </MemoryRouter>
              </SnackbarProvider>
            </DataContext.Provider>
          </SettingsProvider>
        </QueryClientProvider>,
      )
      expect(
        await screen.findByText('Nothing parked for someday', undefined, { timeout: 5000 }),
      ).toBeInTheDocument()
    },
  )
})
