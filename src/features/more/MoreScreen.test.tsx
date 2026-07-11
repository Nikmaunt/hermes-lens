// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { MoreScreen } from './MoreScreen'

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

function renderMore(counts: { pendingCount: number; deadLetterCount: number }) {
  const kv = new MemoryKV()
  const value = {
    ds: { kind: 'mock' } as DataSource,
    cache: createEndpointCache(kv),
    queue: createMutationQueue(kv),
    ...counts,
  }
  render(
    <SettingsProvider>
      <MemoryRouter>
        <DataContext.Provider value={value}>
          <MoreScreen />
        </DataContext.Provider>
      </MemoryRouter>
    </SettingsProvider>,
  )
}

describe('More hub sync badges', () => {
  it('shows the dead-letter count next to the pending badge', () => {
    renderMore({ pendingCount: 1, deadLetterCount: 2 })
    expect(screen.getByText('1 action waiting to sync')).toBeInTheDocument()
    expect(screen.getByText('2 actions failed to sync — review in Settings')).toBeInTheDocument()
  })

  it('shows the dead-letter badge even with nothing pending, and hides both at zero', () => {
    renderMore({ pendingCount: 0, deadLetterCount: 1 })
    expect(screen.getByText('1 action failed to sync — review in Settings')).toBeInTheDocument()
    expect(screen.queryByText(/waiting to sync/)).toBeNull()

    cleanup()
    renderMore({ pendingCount: 0, deadLetterCount: 0 })
    expect(screen.queryByText(/failed to sync/)).toBeNull()
  })
})
