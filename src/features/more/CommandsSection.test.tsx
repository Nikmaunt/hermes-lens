// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { SettingsProvider } from '@/settings/SettingsProvider'
import type { CommandStatus } from '@/schemas'
import { MoreScreen } from './MoreScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

function renderMore(items: CommandStatus[]) {
  const kv = new MemoryKV()
  const ds = {
    kind: 'mock',
    getCommands: () =>
      Promise.resolve({ items, generatedAt: '2026-07-12T10:00:00+02:00' }),
  } as unknown as DataSource
  const value = {
    ds,
    cache: createEndpointCache(kv),
    queue: createMutationQueue(kv),
    pendingCount: 0,
    deadLetterCount: 0,
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <MemoryRouter initialEntries={['/more']}>
          <DataContext.Provider value={value}>
            <Routes>
              <Route path="/more" element={<MoreScreen />} />
              <Route path="/briefs/:id" element={<div>brief detail screen</div>} />
            </Routes>
          </DataContext.Provider>
        </MemoryRouter>
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

const ITEMS: CommandStatus[] = [
  {
    commandId: 'cmd-1',
    type: 'adhoc-digest',
    requestedAt: '2026-07-12T09:00:00+02:00',
    state: 'pending',
  },
  {
    commandId: 'cmd-2',
    type: 'create-note',
    requestedAt: '2026-07-12T09:05:00+02:00',
    state: 'running',
  },
  {
    commandId: 'cmd-3',
    type: 'adhoc-digest',
    requestedAt: '2026-07-12T09:10:00+02:00',
    state: 'done',
    summary: 'Digest brief generated',
    result: { kind: 'brief', id: 'brief-42' },
  },
  {
    commandId: 'cmd-4',
    type: 'create-note',
    requestedAt: '2026-07-12T09:15:00+02:00',
    state: 'error',
    summary: 'Person file could not be written',
  },
  {
    commandId: 'cmd-5',
    type: 'create-note',
    requestedAt: '2026-07-12T09:20:00+02:00',
    state: 'done',
    summary: 'Note saved to People',
    result: { kind: 'note', id: 'note-7' },
  },
]

describe('More → Commands section', () => {
  it('renders recent commands with all four state badges and their summaries', async () => {
    renderMore(ITEMS)

    expect(await screen.findByText('Commands')).toBeInTheDocument()
    for (const state of ['pending', 'running', 'error']) {
      expect(screen.getByText(state)).toBeInTheDocument()
    }
    expect(screen.getAllByText('done').length).toBe(2)
    expect(screen.getByText('Digest brief generated')).toBeInTheDocument()
    expect(screen.getByText('Person file could not be written')).toBeInTheDocument()
  })

  it('deep-links a done digest to its brief', async () => {
    renderMore(ITEMS)
    await screen.findByText('Digest brief generated')

    await userEvent.click(screen.getByRole('button', { name: /Digest brief generated/ }))
    expect(await screen.findByText('brief detail screen')).toBeInTheDocument()
  })

  it('shows a note result as a plain id — there is no note detail screen to link', async () => {
    renderMore(ITEMS)
    await screen.findByText('Note saved to People')

    // The id is visible for reference but the row is not a link/button.
    expect(screen.getByText(/note-7/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /note-7/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Note saved to People/ })).toBeNull()
  })

  it('says so quietly when no command was ever queued', async () => {
    renderMore([])
    expect(await screen.findByText(/No commands yet/)).toBeInTheDocument()
  })
})
