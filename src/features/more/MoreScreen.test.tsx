// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

async function bootToMore() {
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
}

describe('the More hub no longer offers Polish words', () => {
  it(
    'lists the other feature entries but not the retired Polish flashcards',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToMore()

      // The hub still renders — sibling entries are present.
      expect(await screen.findByText('Habits', undefined, { timeout: 5000 })).toBeInTheDocument()
      expect(screen.getByText('Memory')).toBeInTheDocument()

      // The Polish words flashcard screen was removed from the client entirely.
      expect(screen.queryByText('Polish words')).toBeNull()
    },
  )
})
