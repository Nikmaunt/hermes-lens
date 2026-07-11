// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/data/ApiDataSource'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue, type MutationQueue, type QueuedMutation } from '@/data/mutationQueue'
import { DeadLetterNotifier } from './DeadLetterNotifier'
import { SnackbarProvider } from './SnackbarProvider'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const captureItem = (n: number): QueuedMutation => ({
  id: `q${n}`,
  kind: 'capture',
  source: 'api',
  enqueuedAt: new Date().toISOString(),
  req: { text: `note ${n}`, tags: [] },
})

const rejecting400 = {
  kind: 'api',
  capture: () => Promise.reject(new ApiError('Agent returned 400', 'server', 400)),
} as unknown as DataSource

function renderNotifier(kv: MemoryKV, queue: MutationQueue) {
  render(
    <DataContext.Provider
      value={{
        ds: { kind: 'api' } as DataSource,
        cache: createEndpointCache(kv),
        queue,
        pendingCount: 0,
        deadLetterCount: 0,
      }}
    >
      <SnackbarProvider>
        <DeadLetterNotifier />
      </SnackbarProvider>
    </DataContext.Provider>,
  )
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

describe('DeadLetterNotifier', () => {
  it('shows a one-shot snackbar when a drain parks new dead letters', async () => {
    const kv = new MemoryKV()
    const queue = createMutationQueue(kv)
    renderNotifier(kv, queue)
    await flush() // baseline hydrated: 0 dead letters

    await act(async () => {
      await queue.enqueue(captureItem(1))
      await queue.drain(rejecting400)
    })

    expect(
      await screen.findByText('1 action failed to sync — review in Settings'),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/failed to sync/)).toHaveLength(1)
  })

  it('stays silent for dead letters that already existed when it mounted', async () => {
    // Dead letters only ever appear while the app is running, so anything
    // present at boot was already announced in a previous session — a
    // snackbar on every launch would just train the user to ignore it.
    const kv = new MemoryKV()
    const queue = createMutationQueue(kv)
    await queue.enqueue(captureItem(1))
    await queue.drain(rejecting400)
    expect((await queue.deadLetters()).length).toBe(1)

    renderNotifier(kv, queue)
    await flush()

    expect(screen.queryByText(/failed to sync/)).toBeNull()
  })
})
