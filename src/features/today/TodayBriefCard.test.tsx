// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/App'
import { preferencesKV } from '@/data/kv'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

// The morning brief the today fixture points Today at.
const BRIEF_ID = 'brief-d0-morning'
const BRIEF_TITLE = 'Morning brief — quiet day, two things need you'

beforeEach(async () => {
  // Read-state is a client-only kv set; start each case from a known state.
  await preferencesKV.set('briefs:read', JSON.stringify([]))
})

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
  await waitFor(() => expect(screen.getByText('Open follow-ups')).toBeInTheDocument(), {
    timeout: 5000,
  })
}

describe("Today's morning-brief card", () => {
  it(
    'shows the full card while the brief is unread',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToToday()
      // Full card: real title, "today's brief" subtitle, an unread dot.
      const title = await screen.findByText(BRIEF_TITLE, undefined, { timeout: 5000 })
      expect(screen.getByText("today's brief")).toBeInTheDocument()
      // The unread dot lives inside the card (scoped — the Briefs tab shows
      // its own "unread" dot too).
      const card = title.closest('button')
      expect(card).not.toBeNull()
      expect(within(card as HTMLElement).getByLabelText('unread')).toBeInTheDocument()
      // The collapsed strip is not shown yet.
      expect(screen.queryByText('Morning brief · read')).toBeNull()
    },
  )

  it(
    'collapses to a one-line strip once the brief is read',
    { timeout: TEST_TIMEOUT },
    async () => {
      await preferencesKV.set('briefs:read', JSON.stringify([BRIEF_ID]))
      await bootToToday()
      // Collapsed: the thin strip replaces the full card.
      expect(
        await screen.findByText('Morning brief · read', undefined, { timeout: 5000 }),
      ).toBeInTheDocument()
      // The full card is gone: no title, no "today's brief" subtitle.
      expect(screen.queryByText(BRIEF_TITLE)).toBeNull()
      expect(screen.queryByText("today's brief")).toBeNull()
    },
  )

  it(
    'reopens as a full card when a new, unread brief arrives',
    { timeout: TEST_TIMEOUT },
    async () => {
      // A previous day's brief was read; the current one is still unread.
      await preferencesKV.set('briefs:read', JSON.stringify(['brief-yesterday-morning']))
      await bootToToday()
      expect(await screen.findByText(BRIEF_TITLE, undefined, { timeout: 5000 })).toBeInTheDocument()
      expect(screen.getByText("today's brief")).toBeInTheDocument()
      expect(screen.queryByText('Morning brief · read')).toBeNull()
    },
  )

  it(
    'opens the brief when the collapsed strip is tapped',
    { timeout: TEST_TIMEOUT },
    async () => {
      await preferencesKV.set('briefs:read', JSON.stringify([BRIEF_ID]))
      await bootToToday()
      await userEvent.click(
        await screen.findByText('Morning brief · read', undefined, { timeout: 5000 }),
      )
      // The brief detail screen renders the full title.
      expect(await screen.findByText(BRIEF_TITLE, undefined, { timeout: 5000 })).toBeInTheDocument()
    },
  )
})
