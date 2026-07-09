// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'
import { snoozeTomorrow } from '@/lib/snooze'

// Vitest runs without injected globals, so RTL's auto-cleanup never
// registers — unmount explicitly or the next boot sees two apps.
afterEach(cleanup)

/*
 * Follow-up done/snooze from the Today screen, against the demo data source.
 * The "syncing" treatment must come from either source equally: a server
 * pendingAction (fixture fu-6) and a just-clicked local action look the same.
 */

async function bootToToday() {
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

// App boots (first-run gate + mock latency) make these slower than the 5 s default.
const TEST_TIMEOUT = 20_000

describe('follow-up actions on Today', () => {
  it('renders a fixture pendingAction as syncing with its buttons hidden', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    // fu-6 ships with a pendingAction from the fixtures.
    const title = await screen.findByText(
      'Renew the library card before it lapses',
      undefined,
      { timeout: 5000 },
    )
    expect(title.className).toContain('line-through')
    expect(screen.getAllByText('syncing').length).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'Done: Renew the library card before it lapses' }),
    ).toBeNull()
  })

  it('marks a follow-up done: optimistic syncing state, buttons gone', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    const doneBtn = await screen.findByRole(
      'button',
      { name: 'Done: Confirm dentist appointment for next week' },
      { timeout: 5000 },
    )
    await userEvent.click(doneBtn)

    await waitFor(() => {
      const title = screen.getByText('Confirm dentist appointment for next week')
      expect(title.className).toContain('line-through')
    })
    expect(
      screen.queryByRole('button', { name: 'Done: Confirm dentist appointment for next week' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Snooze: Confirm dentist appointment for next week' }),
    ).toBeNull()
  })

  it('done shows an undo snackbar and undo restores the card', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    const title = "Reply to Rosa about moving Thursday's lesson"
    const doneBtn = await screen.findByRole('button', { name: `Done: ${title}` }, { timeout: 5000 })
    await userEvent.click(doneBtn)

    // Snackbar arrives once the action settled (sent or queued).
    await screen.findByText('Marked done', undefined, { timeout: 5000 })
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

    // The optimistic syncing state clears and the buttons come back.
    await waitFor(
      () => expect(screen.getByRole('button', { name: `Done: ${title}` })).toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(screen.getByText(title).className).not.toContain('line-through')
    // Let the background undo request settle before the next boot reads the
    // overlay — a later test relies on fu-1 having its buttons back.
    await new Promise((resolve) => setTimeout(resolve, 1500))
  })

  it('snooze shows a dated undo snackbar and undo restores the card', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    const title = 'Send Clara the apartment photos she asked for'
    const snoozeBtn = await screen.findByRole('button', { name: `Snooze: ${title}` }, { timeout: 5000 })
    await userEvent.click(snoozeBtn)
    await userEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }))

    await screen.findByText(/^Snoozed to /, undefined, { timeout: 5000 })
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(
      () => expect(screen.getByRole('button', { name: `Snooze: ${title}` })).toBeInTheDocument(),
      { timeout: 5000 },
    )
  })

  it('shows an Undo button on a syncing card; gone explains the agent resolved it', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    // fu-6 ships with a server-side pendingAction: its queue file is out of
    // reach, so an undo comes back "gone" and the card is quietly dropped.
    const title = 'Renew the library card before it lapses'
    const undoBtn = await screen.findByRole('button', { name: `Undo: ${title}` }, { timeout: 5000 })
    await userEvent.click(undoBtn)

    await screen.findByText('The agent already resolved this follow-up', undefined, { timeout: 5000 })
    expect(screen.queryByText(title)).toBeNull()
    // Informational only — no Undo action on this snackbar.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('offers "Pick a date…" instead of a bare date input; min is tomorrow', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    const title = 'Book a slot for the driving licence photo'
    const snoozeBtn = await screen.findByRole('button', { name: `Snooze: ${title}` }, { timeout: 5000 })
    await userEvent.click(snoozeBtn)

    // The visible control is a button styled like its neighbours; the real
    // date input stays in the DOM (hidden) as the picker target.
    expect(await screen.findByRole('button', { name: 'Pick a date…' })).toBeInTheDocument()
    const input = screen.getByLabelText<HTMLInputElement>('Snooze until date')
    expect(input.min).toBe(snoozeTomorrow())
    expect(input.className).toContain('sr-only')

    // A picked date applies immediately as a snooze.
    fireEvent.change(input, { target: { value: input.min } })
    await waitFor(() => {
      expect(screen.getByText(title).className).toContain('line-through')
    })
  })

  it('ignores a past date sneaking through the picker', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    // fu-3 is only read here and snoozed by a later test — no residue races.
    const title = 'Decide: keep or cancel gym membership'
    const snoozeBtn = await screen.findByRole('button', { name: `Snooze: ${title}` }, { timeout: 5000 })
    await userEvent.click(snoozeBtn)

    const input = await screen.findByLabelText<HTMLInputElement>('Snooze until date')
    fireEvent.change(input, { target: { value: '2020-01-01' } })
    // No snooze fired: the card keeps its buttons.
    expect(screen.getByText(title).className).not.toContain('line-through')
    expect(screen.getByRole('button', { name: `Done: ${title}` })).toBeInTheDocument()
  })

  it('withholds the card Undo while the original request is in flight', { timeout: TEST_TIMEOUT }, async () => {
    // An undo racing the action it cancels would answer "gone" and then lose
    // to the late-arriving original — so Undo waits for the POST to settle.
    await bootToToday()
    const title = 'Send Clara the apartment photos she asked for'
    const doneBtn = await screen.findByRole('button', { name: `Done: ${title}` }, { timeout: 5000 })
    await userEvent.click(doneBtn)

    // Syncing state is synchronous; the Undo button is not there yet.
    await waitFor(() => expect(screen.getByText(title).className).toContain('line-through'))
    expect(screen.queryByRole('button', { name: `Undo: ${title}` })).toBeNull()

    // Once the request settles, the card offers Undo.
    expect(
      await screen.findByRole('button', { name: `Undo: ${title}` }, { timeout: 5000 }),
    ).toBeInTheDocument()
  })

  it('moves a follow-up to someday: syncing card, snackbar Undo restores it', { timeout: TEST_TIMEOUT }, async () => {
    // fu-1 is the only fixture item earlier tests leave without a pending
    // action (its done was undone), so the buttons are guaranteed back.
    await bootToToday()
    const title = "Reply to Rosa about moving Thursday's lesson"
    const somedayBtn = await screen.findByRole(
      'button',
      { name: `To someday: ${title}` },
      { timeout: 5000 },
    )
    await userEvent.click(somedayBtn)

    // Same optimistic mechanics as done: syncing card, buttons gone.
    await waitFor(() => expect(screen.getByText(title).className).toContain('line-through'))
    expect(screen.getByText('moved to someday')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Done: ${title}` })).toBeNull()
    expect(screen.queryByRole('button', { name: `Snooze: ${title}` })).toBeNull()

    // Snackbar arrives once the action settled; Undo restores the card.
    await screen.findByText('Moved to someday', undefined, { timeout: 5000 })
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(
      () => expect(screen.getByRole('button', { name: `Done: ${title}` })).toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(screen.getByText(title).className).not.toContain('line-through')
  })

  it('snoozes a follow-up to next Monday from the snooze menu', { timeout: TEST_TIMEOUT }, async () => {
    await bootToToday()
    const snoozeBtn = await screen.findByRole(
      'button',
      { name: 'Snooze: Decide: keep or cancel gym membership' },
      { timeout: 5000 },
    )
    await userEvent.click(snoozeBtn)

    const monday = await screen.findByRole('button', { name: 'Next Monday' })
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.getByLabelText('Snooze until date')).toBeInTheDocument()
    await userEvent.click(monday)

    await waitFor(() => {
      const title = screen.getByText('Decide: keep or cancel gym membership')
      expect(title.className).toContain('line-through')
    })
  })
})
