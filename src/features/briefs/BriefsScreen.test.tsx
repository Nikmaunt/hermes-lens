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
import type { BriefListItem } from '@/schemas'
import { BriefsScreen } from './BriefsScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

async function bootToToday() {
  // jsdom keeps the URL across tests in a file; a previous test may have
  // navigated deep into the router. Every boot starts from the root.
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
  await waitFor(
    () => expect(screen.getByText('Open follow-ups')).toBeInTheDocument(),
    { timeout: 5000 },
  )
}

describe('briefs', () => {
  it(
    'shows the Today brief card unread, opens it and renders the markdown',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToToday()

      const card = await screen.findByRole(
        'button',
        { name: /Morning brief — quiet day, two things need you/ },
        { timeout: 5000 },
      )
      // Never opened → unread dot on the Today card.
      expect(within(card).getByLabelText('unread')).toBeInTheDocument()
      await userEvent.click(card)

      // Detail: date + kind badge + tolerant-formatter markdown (marks stripped).
      await waitFor(
        () => expect(screen.getByText('Top of mind')).toBeInTheDocument(),
        { timeout: 5000 },
      )
      expect(screen.getByText('morning')).toBeInTheDocument()
      expect(screen.queryByText(/##/)).toBeNull()
      // Bold marks are stripped by the formatter, words survive.
      expect(screen.getByText(/Rosa's lesson/)).toBeInTheDocument()
      expect(screen.queryByText(/\*\*/)).toBeNull()
    },
  )

  it(
    'lists briefs in More grouped by day; kind badges only on today\'s cards',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToToday()
      await userEvent.click(screen.getByText('More'))
      await userEvent.click(await screen.findByText('Briefs', undefined, { timeout: 5000 }))

      await waitFor(
        () =>
          expect(
            screen.getByText('Heads-up: lease cancel window opens soon'),
          ).toBeInTheDocument(),
        { timeout: 5000 },
      )
      // Kind badges only on today's briefs — history rows drop them (the
      // kind is redundant in a mostly-morning feed).
      expect(screen.getAllByText('morning')).toHaveLength(1)
      expect(screen.getAllByText('adhoc')).toHaveLength(1)

      // The brief opened in the previous test is read; the others are not.
      // (waitFor: the list can render from the warm cache before the async
      // read-state load resolves.)
      const readRow = screen.getByRole('button', {
        name: /Morning brief — quiet day, two things need you/,
      })
      await waitFor(() => expect(within(readRow).queryByLabelText('unread')).toBeNull())
      const unreadRow = screen.getByRole('button', {
        name: /Heads-up: lease cancel window opens soon/,
      })
      expect(within(unreadRow).getByLabelText('unread')).toBeInTheDocument()

      // Grouped under day headers: today's two briefs share one group header.
      expect(screen.getAllByRole('heading').length).toBeGreaterThanOrEqual(2)

      // Opening an unread brief clears its dot when we come back.
      await userEvent.click(unreadRow)
      await waitFor(
        () => expect(screen.getByText(/apartment lease/)).toBeInTheDocument(),
        { timeout: 5000 },
      )
      await userEvent.click(screen.getByLabelText('Back'))
      await waitFor(
        () => {
          const row = screen.getByRole('button', {
            name: /Heads-up: lease cancel window opens soon/,
          })
          expect(within(row).queryByLabelText('unread')).toBeNull()
        },
        { timeout: 5000 },
      )
    },
  )
})

async function bootToBriefs() {
  await bootToToday()
  await userEvent.click(screen.getByText('More'))
  await userEvent.click(await screen.findByText('Briefs', undefined, { timeout: 5000 }))
  await waitFor(
    () =>
      expect(screen.getByText('Heads-up: lease cancel window opens soon')).toBeInTheDocument(),
    { timeout: 5000 },
  )
}

describe('briefs list upgrades', () => {
  it('filters by kind with the All / Morning / Adhoc chips', { timeout: TEST_TIMEOUT }, async () => {
    await bootToBriefs()

    await userEvent.click(screen.getByRole('button', { name: 'Morning' }))
    await waitFor(() =>
      expect(screen.queryByText('Heads-up: lease cancel window opens soon')).toBeNull(),
    )
    expect(screen.getAllByText(/Morning brief/).length).toBeGreaterThanOrEqual(4)

    await userEvent.click(screen.getByRole('button', { name: 'Adhoc' }))
    await waitFor(() =>
      expect(screen.getByText('Heads-up: lease cancel window opens soon')).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Morning brief — quiet day/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() =>
      expect(screen.getByText(/Morning brief — quiet day/)).toBeInTheDocument(),
    )
    expect(screen.getByText('Heads-up: lease cancel window opens soon')).toBeInTheDocument()
  })

  it('mark all read clears every unread dot in the list', { timeout: TEST_TIMEOUT }, async () => {
    await bootToBriefs()
    // Scoped to main: the BottomNav briefs dot refreshes on navigation, not
    // live — the list itself must clear immediately.
    const main = screen.getByRole('main')
    await waitFor(() => expect(within(main).queryAllByLabelText('unread').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(within(main).queryAllByLabelText('unread')).toHaveLength(0))
  })

  it('pinning lifts a brief into a Pinned section; unpinning returns it', { timeout: TEST_TIMEOUT }, async () => {
    await bootToBriefs()
    const title = 'Morning brief — slow week so far'
    const rowOf = () => screen.getByText(title).closest('div') as HTMLElement

    await userEvent.click(within(rowOf()).getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(screen.getByText('Pinned')).toBeInTheDocument())
    expect(within(rowOf()).getByRole('button', { name: 'Unpin' })).toBeInTheDocument()

    await userEvent.click(within(rowOf()).getByRole('button', { name: 'Unpin' }))
    await waitFor(() => expect(screen.queryByText('Pinned')).toBeNull())
    expect(within(rowOf()).getByRole('button', { name: 'Pin' })).toBeInTheDocument()
  })
})

describe('briefs list polish', () => {
  it(
    'date separators share one flow container, so the Today-style rhythm applies',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToBriefs()
      const main = screen.getByRole('main')
      const headings = within(main).getAllByRole('heading', { level: 2 })
      expect(headings.length).toBeGreaterThanOrEqual(2)
      // A header wrapped in a per-group div becomes its :first-child and
      // loses the mt-6 gap — flat siblings keep the separator off the
      // previous group's last card.
      const containers = new Set(headings.map((h) => h.parentElement?.parentElement))
      expect(containers.size).toBe(1)
    },
  )

  it(
    'past briefs are compact rows without the kind badge; today keeps the card',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToBriefs()

      const pastRow = screen
        .getByRole('button', { name: /Morning brief — gym day, one deadline moved/ })
        .closest('div') as HTMLElement
      expect(within(pastRow).queryByText('morning')).toBeNull()

      const todayRow = screen
        .getByRole('button', { name: /Morning brief — quiet day, two things need you/ })
        .closest('div') as HTMLElement
      expect(within(todayRow).getByText('morning')).toBeInTheDocument()

      // Compact rows still carry the pin affordance and the unread dot.
      expect(within(pastRow).getByRole('button', { name: 'Pin' })).toBeInTheDocument()
    },
  )
})

/** BriefsScreen with an injected data source, for shapes the fixtures never take. */
function renderBriefsWith(items: BriefListItem[]) {
  const kv = new MemoryKV()
  const ds = {
    kind: 'mock',
    getBriefs: async () => ({ items }),
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
            <MemoryRouter initialEntries={['/briefs']}>
              <BriefsScreen />
            </MemoryRouter>
          </SnackbarProvider>
        </DataContext.Provider>
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

describe('adhoc filter visibility', () => {
  it(
    'hides the Adhoc chip while the data has no adhoc briefs; All stays',
    { timeout: TEST_TIMEOUT },
    async () => {
      renderBriefsWith([
        { id: 'b-m1', date: '2026-07-10', title: 'Morning brief — calm day', kind: 'morning' },
        { id: 'b-m2', date: '2026-07-09', title: 'Morning brief — errands', kind: 'morning' },
      ])
      await screen.findByText('Morning brief — calm day', undefined, { timeout: 5000 })
      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Morning' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Adhoc' })).toBeNull()
    },
  )

  it(
    'shows the Adhoc chip as soon as an adhoc brief exists',
    { timeout: TEST_TIMEOUT },
    async () => {
      renderBriefsWith([
        { id: 'b-m1', date: '2026-07-10', title: 'Morning brief — calm day', kind: 'morning' },
        { id: 'b-a1', date: '2026-07-10', title: 'Heads-up: parcel arriving', kind: 'adhoc' },
      ])
      await screen.findByText('Heads-up: parcel arriving', undefined, { timeout: 5000 })
      expect(screen.getByRole('button', { name: 'Adhoc' })).toBeInTheDocument()
    },
  )
})
