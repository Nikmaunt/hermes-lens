// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { App } from './App'

/**
 * Full-app smoke test: providers wire up, settings load from the Preferences
 * web fallback, the mock data source materializes fixtures, and the Today
 * screen renders real content without crashing.
 */
describe('App smoke', () => {
  it('boots to the Today screen on mock data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

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
  })
})
