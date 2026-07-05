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
      // Each row carries an Undo action (server-side untriage).
      expect(within(row as HTMLElement).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
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

  it(
    'undo on an already-processed entry says so and drops the row',
    { timeout: TEST_TIMEOUT },
    async () => {
      // gone-1 (seeded in the first test) was never triaged in this mock —
      // exactly the "agent already handled it" case: untriage answers gone.
      await bootToInbox()
      const row = (await screen.findByText('Note already shipped to the vault', undefined, {
        timeout: 5000,
      })).closest('li')
      expect(row).not.toBeNull()
      await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Undo' }))

      await screen.findByText('Already processed by agent', undefined, { timeout: 5000 })
      await waitFor(
        () => expect(screen.queryByText('Note already shipped to the vault')).toBeNull(),
        { timeout: 5000 },
      )
      // Let the invalidation-triggered background refetch finish before the
      // next test boots — the revalidation dedup map is module-level and a
      // straggler job would swallow the next boot's refresh.
      await new Promise((resolve) => setTimeout(resolve, 1000))
    },
  )

  it(
    'undo of a sent triage returns the note to the inbox deck',
    { timeout: TEST_TIMEOUT },
    async () => {
      // A triage that already reached the server: the overlay hides in-4 and
      // only the processing log remembers it.
      const overlayRaw = await preferencesKV.get('mock:overlay')
      const overlay = overlayRaw === null ? {} : (JSON.parse(overlayRaw) as Record<string, unknown>)
      const triaged = Array.isArray(overlay.triagedIds) ? (overlay.triagedIds as string[]) : []
      await preferencesKV.set(
        'mock:overlay',
        JSON.stringify({ ...overlay, triagedIds: [...triaged, 'in-4'] }),
      )
      await preferencesKV.set(
        'inbox:processing-log',
        JSON.stringify([
          {
            itemId: 'in-4',
            text: 'Recipe worth keeping: white bean stew',
            destination: 'note',
            at: toIsoDateTime(new Date()),
          },
        ]),
      )
      await bootToInbox()

      // Wait for the deck to settle on fresh data first: the entry shows in
      // Processing only once the refetched payload hides in-4.
      const row = (await screen.findByText('Recipe worth keeping: white bean stew', undefined, {
        timeout: 5000,
      })).closest('li')
      const before = Number(
        /(\d+) to triage/.exec(screen.getByText(/to triage/).textContent ?? '')?.[1],
      )
      expect(Number.isFinite(before)).toBe(true)
      await userEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Undo' }))

      // ok: the entry leaves Processing and the refetched deck grows by one.
      await waitFor(
        () => expect(screen.queryByText('Recipe worth keeping: white bean stew')).toBeNull(),
        { timeout: 5000 },
      )
      await waitFor(
        () => expect(screen.getByText(`${before + 1} to triage`)).toBeInTheDocument(),
        { timeout: 5000 },
      )
      expect(screen.queryByText('Already processed by agent')).toBeNull()
    },
  )

  it(
    'undo before the triage fires cancels it and puts the card back on the deck',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToInbox()
      // Top of the deck at this point: the in-1 novel idea note.
      const card = screen.getByText(/Idea for the novel/).closest('[class*="touch-none"]')
      expect(card).not.toBeNull()
      fireEvent.pointerDown(card as HTMLElement, { clientX: 10, clientY: 200, pointerId: 1 })
      fireEvent.pointerMove(card as HTMLElement, { clientX: 180, clientY: 200, pointerId: 1 })
      fireEvent.pointerUp(card as HTMLElement, { clientX: 180, clientY: 200, pointerId: 1 })

      // The row lands in Processing while the triage waits out its window…
      const row = await waitFor(
        () => {
          const el = screen.getByText(/Idea for the novel/).closest('li')
          expect(el).not.toBeNull()
          return el as HTMLElement
        },
        { timeout: 5000 },
      )
      // …and its Undo cancels the pending triage: the card returns on top.
      await userEvent.click(within(row).getByRole('button', { name: 'Undo' }))
      await waitFor(
        () => {
          const deckCard = screen.getByText(/Idea for the novel/).closest('[class*="touch-none"]')
          expect(deckCard).not.toBeNull()
        },
        { timeout: 5000 },
      )
    },
  )
})
