// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { SnackbarProvider } from '@/components/SnackbarProvider'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV, preferencesKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { TodayScreen } from './TodayScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

// App boots (first-run gate + mock latency) make these slower than the 5 s default.
const TEST_TIMEOUT = 20_000

/*
 * Collapsible Today sections: per-section defaults, kv-persisted user
 * choices, the Someday section fed by the same list/mutations as the
 * Someday screen, and the snackbar View link that reveals it.
 */

/** Wipe stored section choices so a test starts from the product defaults. */
const resetSectionChoices = () => preferencesKV.remove('today:sections')

async function bootToToday() {
  window.history.replaceState({}, '', '/')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
  // First test in the file passes the first-run gate; later boots skip it.
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

/** TodayScreen with an injected data source, for shapes the fixtures never take. */
function renderTodayWith(ds: Partial<DataSource>) {
  const kv = new MemoryKV()
  const value = {
    ds: ds as DataSource,
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
            <MemoryRouter initialEntries={['/']}>
              <TodayScreen />
            </MemoryRouter>
          </SnackbarProvider>
        </DataContext.Provider>
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

const emptyToday = {
  date: '2026-07-10',
  followUps: [],
  deadlines: [],
  agentActivity: [],
  inboxCount: 0,
  generatedAt: '2026-07-10T08:00:00+02:00',
}

describe('collapsible Today sections', () => {
  it('applies the default section states on a fresh boot', { timeout: TEST_TIMEOUT }, async () => {
    await resetSectionChoices()
    await bootToToday()

    // Open follow-ups: the core of the screen, always expanded by default.
    const followups = screen.getByRole('button', { name: /^open follow-ups ?· 6$/i })
    expect(followups).toHaveAttribute('aria-expanded', 'true')
    expect(
      await screen.findByText('Confirm dentist appointment for next week', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument()

    // Deadlines: the demo fixtures have upcoming ones, so it starts expanded.
    expect(screen.getByRole('button', { name: /^deadlines ?· \d+$/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    // Agent: the noisiest block, collapsed by default, no count.
    expect(screen.getByRole('button', { name: /^agent, last 24 h$/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    // Someday: new section, collapsed with a count, content unmounted.
    const someday = screen.getByRole('button', { name: /^someday ?· 3$/i })
    expect(someday).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Plan the Cascades hiking trip')).toBeNull()
  })

  it(
    'renders the demo someday items with the same chip actions as the Someday screen',
    { timeout: TEST_TIMEOUT },
    async () => {
      await resetSectionChoices()
      await bootToToday()
      await userEvent.click(screen.getByRole('button', { name: /^someday ?· 3$/i }))

      expect(
        await screen.findByText('Plan the Cascades hiking trip'),
      ).toBeInTheDocument()
      expect(screen.getByText('telegram, parked from follow-ups')).toBeInTheDocument()

      // Close → syncing card → snackbar Undo restores it, exactly the
      // Someday-screen flow.
      const title = 'Research a standing desk for the home office'
      await userEvent.click(screen.getByRole('button', { name: `Close: ${title}` }))
      await waitFor(() => expect(screen.getByText(title).className).toContain('line-through'))

      await screen.findByText('Closed', undefined, { timeout: 5000 })
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(
        () => expect(screen.getByRole('button', { name: `Close: ${title}` })).toBeInTheDocument(),
        { timeout: 5000 },
      )
      // Let the background undo request settle before the next boot reads the
      // overlay — later boots rely on sd-2 being clean.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    },
  )

  it('a header tap overrides the default and survives a remount', { timeout: TEST_TIMEOUT }, async () => {
    await resetSectionChoices()
    await bootToToday()

    await userEvent.click(screen.getByRole('button', { name: /^agent, last 24 h$/i }))
    expect(screen.getByRole('button', { name: /^agent, last 24 h$/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: /^open follow-ups/i }))
    expect(screen.getByRole('button', { name: /^open follow-ups/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByText('Confirm dentist appointment for next week')).toBeNull()

    cleanup()
    await bootToToday()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent, last 24 h$/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(screen.getByRole('button', { name: /^open follow-ups/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })
    await resetSectionChoices()
  })

  it(
    'the Moved-to-someday snackbar offers View, which reveals the someday section',
    { timeout: TEST_TIMEOUT },
    async () => {
      await resetSectionChoices()
      await bootToToday()

      // A11y tail: the screen-reader name now matches the visible "Someday"
      // label — the old "To someday:" prefix is gone.
      const title = "Reply to Rosa about moving Thursday's lesson"
      expect(
        screen.queryByRole('button', {
          name: 'To someday: Confirm dentist appointment for next week',
        }),
      ).toBeNull()
      const chip = await screen.findByRole('button', { name: `Someday: ${title}` }, { timeout: 5000 })
      await userEvent.click(chip)

      await screen.findByText('Moved to someday', undefined, { timeout: 5000 })
      // Undo still leads; View sits beside it.
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'View' }))

      expect(screen.getByRole('button', { name: /^someday ?· 3$/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(screen.getByText('Plan the Cascades hiking trip')).toBeInTheDocument()
    },
  )

  it(
    'an empty deadlines section defaults to collapsed with a zero count; so does someday',
    { timeout: TEST_TIMEOUT },
    async () => {
      await resetSectionChoices()
      renderTodayWith({
        kind: 'mock',
        getToday: () => Promise.resolve(emptyToday),
        getSomeday: () =>
          Promise.resolve({ items: [], generatedAt: '2026-07-10T08:00:00+02:00' }),
      } as unknown as Partial<DataSource>)

      const deadlines = await screen.findByRole(
        'button',
        { name: /^deadlines ?· 0$/i },
        { timeout: 5000 },
      )
      expect(deadlines).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: /^someday ?· 0$/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    },
  )

  it(
    'a collapsed Someday header previews the first parked item; expanding drops it',
    { timeout: TEST_TIMEOUT },
    async () => {
      await resetSectionChoices()
      renderTodayWith({
        kind: 'mock',
        getToday: () => Promise.resolve(emptyToday),
        getSomeday: () =>
          Promise.resolve({
            items: [
              { id: 'sd-a', title: 'Book a dentist check-up for autumn', source: 'chat' },
              { id: 'sd-b', title: 'Try the wood carving workshop', source: 'chat' },
            ],
            generatedAt: '2026-07-10T08:00:00+02:00',
          }),
      } as unknown as Partial<DataSource>)

      // Collapsed: the hint teases the first item; the accessible name stays
      // "Someday · 2" (the preview is decorative, aria-hidden).
      const header = await screen.findByRole(
        'button',
        { name: /^someday ?· 2$/i },
        { timeout: 5000 },
      )
      expect(header).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('— Book a dentist check-up for autumn')).toBeInTheDocument()

      // Expanded: the hint disappears, the real cards take over.
      await userEvent.click(header)
      expect(screen.queryByText('— Book a dentist check-up for autumn')).toBeNull()
      expect(
        await screen.findByText('Book a dentist check-up for autumn'),
      ).toBeInTheDocument()
    },
  )

  it(
    'agent rows share one right column: time plus a 13px slot, chevron or not',
    { timeout: TEST_TIMEOUT },
    async () => {
      await resetSectionChoices()
      renderTodayWith({
        kind: 'mock',
        getToday: () =>
          Promise.resolve({
            ...emptyToday,
            agentActivity: [
              // No destination (agent) next to a navigable row (capture):
              // the two shapes whose geometry used to differ.
              {
                id: 'act-1',
                at: '2026-07-10T07:58:00+02:00',
                summary: 'Memory distillation run',
                category: 'agent',
              },
              {
                id: 'act-2',
                at: '2026-07-10T07:44:00+02:00',
                summary: 'Captured: bike service reminder',
                category: 'capture',
              },
            ],
          }),
        getSomeday: () =>
          Promise.resolve({ items: [], generatedAt: '2026-07-10T08:00:00+02:00' }),
      } as unknown as Partial<DataSource>)

      await userEvent.click(
        await screen.findByRole('button', { name: /^agent, last 24 h$/i }, { timeout: 5000 }),
      )
      const agentRow = screen.getByRole('button', { name: /Memory distillation run/ })
      const navRow = screen.getByRole('button', { name: /Captured: bike service reminder/ })

      // Both rows end in the same two-part right column: time, then a slot.
      for (const row of [agentRow, navRow]) {
        const right = row.lastElementChild as HTMLElement
        expect(right.children).toHaveLength(2)
        expect(right.children[0]?.className).toContain('tnum')
      }
      // Navigable rows fill the slot with the 13px chevron…
      const chevron = navRow.lastElementChild?.children[1] as HTMLElement
      expect(chevron.tagName.toLowerCase()).toBe('svg')
      expect(chevron).toHaveAttribute('width', '13')
      // …rows without a destination reserve the same 13px so the time
      // column and the right edge line up across the section.
      const slot = agentRow.lastElementChild?.children[1] as HTMLElement
      expect(slot.tagName.toLowerCase()).toBe('span')
      expect(slot.className).toContain('w-[13px]')
    },
  )

  it(
    'someday actions on Today go through ds.somedayAction — the same mutation path',
    { timeout: TEST_TIMEOUT },
    async () => {
      await resetSectionChoices()
      const somedayAction = vi.fn().mockResolvedValue({ status: 'ok', itemId: 'sd-x' })
      renderTodayWith({
        kind: 'mock',
        getToday: () => Promise.resolve(emptyToday),
        getSomeday: () =>
          Promise.resolve({
            items: [{ id: 'sd-x', title: 'Try the wood carving workshop', source: 'chat' }],
            generatedAt: '2026-07-10T08:00:00+02:00',
          }),
        somedayAction,
      } as unknown as Partial<DataSource>)

      await userEvent.click(
        await screen.findByRole('button', { name: /^someday ?· 1$/i }, { timeout: 5000 }),
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Close: Try the wood carving workshop' }),
      )
      await waitFor(() =>
        expect(somedayAction).toHaveBeenCalledWith('sd-x', { action: 'close' }),
      )
    },
  )
})
