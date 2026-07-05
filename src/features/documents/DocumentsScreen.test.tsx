// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'
import { formatMoney } from '@/lib/fmt'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

describe('documents spend summary', () => {
  it(
    'shows month-to-date spend per currency, no cross-currency conversion',
    { timeout: TEST_TIMEOUT },
    async () => {
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
      await userEvent.click(
        await screen.findByText('Documents & Money', undefined, { timeout: 5000 }),
      )

      const row = await screen.findByText(/Spent this month/, undefined, { timeout: 5000 })
      // The fixture ships USD and EUR month-to-date spend; both render through
      // the shared money formatter, separated, never converted into one sum.
      const pln = formatMoney({ cents: 412350, currency: 'USD' })
      const eur = formatMoney({ cents: 2999, currency: 'EUR' })
      const container = row.closest('div')
      expect(container?.textContent).toContain(pln)
      expect(container?.textContent).toContain(eur)
      expect(container?.textContent).toContain('·')
    },
  )
})
