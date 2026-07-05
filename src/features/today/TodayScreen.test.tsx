// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'

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
