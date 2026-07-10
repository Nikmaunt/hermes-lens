// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { App } from '@/App'
import { preferencesKV } from '@/data/kv'
import { formatTime, toIsoDateTime } from '@/lib/dates'
import { nextTriageRun } from './triageSchedule'

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

/** Tap = pointer down/up in place, under the swipe threshold. */
function tap(el: HTMLElement) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 200, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: 100, clientY: 200, pointerId: 1 })
}

describe('auto-triage visibility', () => {
  it(
    'shows the schedule hint with the computed next run time',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToInbox()
      const expected = formatTime(toIsoDateTime(nextTriageRun()))
      expect(
        screen.getByText(`Agent sorts these automatically · next run ${expected}`),
      ).toBeInTheDocument()
    },
  )

  it(
    'destination buttons are secondary chips with accessible names and 44px targets',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToInbox()
      // Default mapping: right→Note, left→Archive, up→Memory, down→Trash.
      for (const name of ['Note', 'Archive', 'Memory', 'Trash']) {
        const chip = screen.getByRole('button', { name })
        // The ActionChip contract: ~32px visible pill + invisible 44px hit area.
        expect(chip.className).toContain('before:h-11')
        expect(chip.className).toContain('min-w-11')
      }
    },
  )

  it(
    'tapping a destination chip triages the top card (optional override)',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToInbox()
      // Top of the deck is the fixture appointment note.
      await userEvent.click(screen.getByRole('button', { name: 'Note' }))
      await waitFor(
        () => {
          const row = screen.getByText(/Boiler inspection/).closest('li')
          expect(row).not.toBeNull()
          expect(within(row as HTMLElement).getByText('→ Note')).toBeInTheDocument()
        },
        { timeout: 5000 },
      )
      // Undo to leave the deck as we found it for the next test.
      const row = screen.getByText(/Boiler inspection/).closest('li') as HTMLElement
      await userEvent.click(within(row).getByRole('button', { name: 'Undo' }))
      await waitFor(
        () => {
          expect(
            screen.getByText(/Boiler inspection/).closest('[class*="touch-none"]'),
          ).not.toBeNull()
        },
        { timeout: 5000 },
      )
    },
  )
})

describe('card expansion', () => {
  it(
    'a tap on the deck card expands it to the full text and back',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToInbox()
      const card = screen
        .getByText(/Boiler inspection/)
        .closest('[class*="touch-none"]') as HTMLElement
      const wrapper = card.parentElement as HTMLElement

      // Collapsed: fixed-height deck, chevron affordance present.
      expect(wrapper.className).toContain('h-80')
      const chevron = screen.getByRole('button', { name: 'Show full note' })
      expect(chevron.getAttribute('aria-expanded')).toBe('false')

      // Tap (not swipe) anywhere on the card expands it.
      tap(card)
      const collapse = await screen.findByRole('button', { name: 'Collapse note' })
      expect(collapse.getAttribute('aria-expanded')).toBe('true')
      expect((card.parentElement as HTMLElement).className).not.toContain('h-80')

      // Tapping again collapses.
      tap(card)
      expect(
        (await screen.findByRole('button', { name: 'Show full note' })).getAttribute(
          'aria-expanded',
        ),
      ).toBe('false')
    },
  )

  it(
    'a swipe still triages and does not count as a tap',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToInbox()
      const card = screen
        .getByText(/Boiler inspection/)
        .closest('[class*="touch-none"]') as HTMLElement
      fireEvent.pointerDown(card, { clientX: 10, clientY: 200, pointerId: 1 })
      fireEvent.pointerMove(card, { clientX: 180, clientY: 200, pointerId: 1 })
      fireEvent.pointerUp(card, { clientX: 180, clientY: 200, pointerId: 1 })
      await waitFor(
        () => {
          const row = screen.getByText(/Boiler inspection/).closest('li')
          expect(row).not.toBeNull()
          expect(within(row as HTMLElement).getByText('→ Note')).toBeInTheDocument()
        },
        { timeout: 5000 },
      )
    },
  )

  it(
    'a Processing row expands to the full text and keeps its route and Undo',
    { timeout: TEST_TIMEOUT },
    async () => {
      await preferencesKV.set(
        'inbox:processing-log',
        JSON.stringify([
          {
            itemId: 'gone-2',
            text: 'Create a reminder to renew the bike lock warranty\ndetails: call the shop before Friday',
            destination: 'trash',
            at: toIsoDateTime(new Date()),
          },
        ]),
      )
      await bootToInbox()

      const firstLine = await screen.findByText(/Create a reminder/, undefined, {
        timeout: 5000,
      })
      // Collapsed: only the first line is rendered.
      expect(screen.queryByText(/call the shop/)).toBeNull()

      const row = firstLine.closest('li') as HTMLElement
      const toggle = within(row).getByRole('button', { expanded: false })
      await userEvent.click(toggle)

      // Expanded: the full text, the chosen route and Undo are all visible.
      expect(await screen.findByText(/call the shop before Friday/)).toBeInTheDocument()
      expect(within(row).getByText('→ Trash')).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { expanded: true })).toBeInTheDocument()
    },
  )
})
