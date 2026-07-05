// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'
import inboxFixture from '@/data/mock/fixtures/inbox.json'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

async function bootToToday() {
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

const nav = () => screen.getByRole('navigation')

describe('bottom tab bar', () => {
  it(
    'shows Today · Inbox · [+] · Briefs · More; Timeline and Memory live in More',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToToday()
      const bar = nav()
      for (const label of ['Today', 'Inbox', 'Briefs', 'More']) {
        expect(within(bar).getByText(label)).toBeInTheDocument()
      }
      expect(within(bar).queryByText('Timeline')).toBeNull()
      expect(within(bar).queryByText('Memory')).toBeNull()

      await userEvent.click(within(bar).getByText('More'))
      // Timeline and Memory sit at the top of the More grid…
      const timeline = await screen.findByText('Timeline', undefined, { timeout: 5000 })
      expect(screen.getByText('Memory')).toBeInTheDocument()
      // …while Inbox and Briefs left the grid for the tab bar.
      expect(screen.getAllByText('Inbox').length).toBe(1) // the tab only
      expect(screen.getAllByText('Briefs').length).toBe(1)

      // The moved routes still work.
      await userEvent.click(timeline)
      await waitFor(
        () => expect(screen.getByRole('heading', { name: /Timeline/ })).toBeInTheDocument(),
        { timeout: 5000 },
      )
    },
  )

  it(
    'Inbox tab wears the unprocessed-notes count from today',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToToday()
      const badge = await within(nav()).findByText(
        String(inboxFixture.items.length),
        undefined,
        { timeout: 5000 },
      )
      expect(badge).toBeInTheDocument()
    },
  )

  it(
    'Briefs tab wears an unread dot while briefs are unread',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToToday()
      expect(
        await within(nav()).findByLabelText('unread', undefined, { timeout: 5000 }),
      ).toBeInTheDocument()
    },
  )

  it(
    'timeline deep link from Today still routes into Timeline',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToToday()
      await userEvent.click(screen.getByText('timeline →'))
      await waitFor(
        () => expect(screen.getByRole('heading', { name: /Timeline/ })).toBeInTheDocument(),
        { timeout: 5000 },
      )
    },
  )
})
