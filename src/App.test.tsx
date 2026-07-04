// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { App } from './App'

/**
 * Full-app smoke test: providers wire up, settings load from the Preferences
 * web fallback, the first-run flow demands an explicit choice (demo data is
 * never silently active), and after picking Demo mode the Today screen
 * renders real fixture content without crashing.
 */
describe('App smoke', () => {
  it('boots to first-run, then to the Today screen after choosing demo mode', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    // Fresh install: the app must ask, not assume.
    const demoButton = await screen.findByText('Try demo mode', undefined, { timeout: 5000 })
    expect(screen.getByText('Connect your agent')).toBeInTheDocument()
    await userEvent.click(demoButton)

    await waitFor(
      () => {
        expect(
          screen.getByText(/Reply to Rosa about moving Thursday's lesson/),
        ).toBeInTheDocument()
      },
      { timeout: 5000 },
    )

    expect(screen.getByText('Open follow-ups')).toBeInTheDocument()
    expect(screen.getByText('Deadlines')).toBeInTheDocument()
    expect(screen.getByText('Agent, last 24 h')).toBeInTheDocument()
    // Demo mode is clearly labeled on-screen.
    expect(screen.getByText('Demo')).toBeInTheDocument()
  })
})
