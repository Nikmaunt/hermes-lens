// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

async function bootToTimeline() {
  // jsdom keeps the URL across tests in a file; every boot starts from root.
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
  await userEvent.click(await screen.findByText('Timeline', undefined, { timeout: 5000 }))
  await waitFor(
    () => expect(screen.getByText('Notification captured')).toBeInTheDocument(),
    { timeout: 5000 },
  )
}

describe('timeline event details', () => {
  it(
    'a notification (system) event expands details in place and never opens Status',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      const row = screen.getByRole('button', { name: /Notification captured/ })
      await userEvent.click(row)

      // Details unfold inside the row: type label and the related record id
      // (the id also sits in the collapsed detail line, hence getAllByText).
      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(within(row).getByText('System')).toBeInTheDocument()
      expect(within(row).getByText('Ref')).toBeInTheDocument()
      expect(
        within(row).getAllByText(/1751955060000-whatsapp-9f3a2b1c/).length,
      ).toBeGreaterThanOrEqual(1)

      // Still on the Timeline — the tap must not jump to Agent Status.
      expect(screen.getByRole('heading', { name: /Timeline/ })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Agent Status/ })).toBeNull()
      expect(screen.queryByText('Telegram gateway')).toBeNull()

      // A second tap folds the details back.
      await userEvent.click(row)
      expect(row).toHaveAttribute('aria-expanded', 'false')
      expect(within(row).queryByText('System')).toBeNull()
    },
  )

  it(
    'an agent event expands with the privacy note instead of a toast',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      const row = screen.getByRole('button', { name: /Morning brief sent/ })
      await userEvent.click(row)
      expect(row).toHaveAttribute('aria-expanded', 'true')
      expect(within(row).getByText(/privately/)).toBeInTheDocument()
    },
  )

  it(
    'capture events still navigate to the Inbox deep-link',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToTimeline()

      await userEvent.click(
        screen.getByRole('button', { name: /Captured: landlord approval template idea/ }),
      )
      await waitFor(
        () => expect(screen.getByRole('heading', { name: /Inbox/ })).toBeInTheDocument(),
        { timeout: 5000 },
      )
    },
  )
})
