// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'

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
    'lists briefs in More grouped by day with kind badges and unread dots',
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
      // Kind badges for both kinds are on screen.
      expect(screen.getAllByText('morning').length).toBeGreaterThanOrEqual(2)
      expect(screen.getAllByText('adhoc').length).toBeGreaterThanOrEqual(1)

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
