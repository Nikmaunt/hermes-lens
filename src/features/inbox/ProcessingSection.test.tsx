// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { App } from '@/App'
import { preferencesKV } from '@/data/kv'
import { toIsoDateTime } from '@/lib/dates'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

beforeAll(() => {
  // jsdom has no pointer capture; the swipe card calls it on pointerdown.
  HTMLElement.prototype.setPointerCapture ??= () => undefined
  HTMLElement.prototype.releasePointerCapture ??= () => undefined
})

async function bootToInbox() {
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
  await userEvent.click(await screen.findByText('Inbox', undefined, { timeout: 5000 }))
  await waitFor(() => expect(screen.getByText(/to triage/)).toBeInTheDocument(), {
    timeout: 5000,
  })
}

describe('inbox Processing section', () => {
  it(
    'shows a recently triaged note from the log, view-only, with its destination',
    { timeout: TEST_TIMEOUT },
    async () => {
      // A triage from an earlier session: the server already hides the item,
      // only the local log remembers it.
      await preferencesKV.set(
        'inbox:processing-log',
        JSON.stringify([
          {
            itemId: 'gone-1',
            text: 'Note already shipped to the vault',
            destination: 'memory',
            at: toIsoDateTime(new Date()),
          },
        ]),
      )
      await bootToInbox()

      expect(await screen.findByText('Processing', undefined, { timeout: 5000 })).toBeInTheDocument()
      const row = screen.getByText('Note already shipped to the vault').closest('li')
      expect(row).not.toBeNull()
      expect(within(row as HTMLElement).getByText('→ Memory')).toBeInTheDocument()
      // View-only: no buttons inside Processing rows.
      expect(within(row as HTMLElement).queryByRole('button')).toBeNull()
    },
  )

  it(
    'moves a swiped note into Processing instead of vanishing',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToInbox()

      // Top of the deck is the fixture appointment note; swipe right → Note.
      const card = screen.getByText(/Boiler inspection/).closest('[class*="touch-none"]')
      expect(card).not.toBeNull()
      fireEvent.pointerDown(card as HTMLElement, { clientX: 10, clientY: 200, pointerId: 1 })
      fireEvent.pointerMove(card as HTMLElement, { clientX: 180, clientY: 200, pointerId: 1 })
      fireEvent.pointerUp(card as HTMLElement, { clientX: 180, clientY: 200, pointerId: 1 })

      // After the fling animation the card leaves the deck and lands below.
      await waitFor(
        () => {
          const processing = screen.getByText('Processing')
          expect(processing).toBeInTheDocument()
          const row = screen.getByText(/Boiler inspection/).closest('li')
          expect(row).not.toBeNull()
          expect(within(row as HTMLElement).getByText('→ Note')).toBeInTheDocument()
        },
        { timeout: 5000 },
      )
    },
  )
})
