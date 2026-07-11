// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SnackbarProvider } from '@/components/SnackbarProvider'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { createEndpointCache } from '@/data/cache'
import { MemoryKV } from '@/data/kv'
import { createMutationQueue } from '@/data/mutationQueue'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { CaptureScreen } from './CaptureScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

function renderCapture(overrides: Partial<DataSource> = {}) {
  const kv = new MemoryKV()
  const queue = createMutationQueue(kv)
  const ds = { kind: 'mock', ...overrides } as unknown as DataSource
  const value = {
    ds,
    cache: createEndpointCache(kv),
    queue,
    pendingCount: 0,
    deadLetterCount: 0,
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <MemoryRouter initialEntries={['/capture']}>
          <DataContext.Provider value={value}>
            <SnackbarProvider>
              <CaptureScreen />
            </SnackbarProvider>
          </DataContext.Provider>
        </MemoryRouter>
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { queue }
}

describe('Capture mode toggle', () => {
  it('offers three modes and keeps Note and Ask behavior unchanged', async () => {
    renderCapture()

    // Three segments, Note active by default with its tag row and caption.
    for (const label of ['Note', 'Ask', 'Command']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByPlaceholderText("What's on your mind?")).toBeInTheDocument()
    expect(screen.getByText('#idea')).toBeInTheDocument()
    expect(screen.getByText(/Lands in the agent's inbox/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to Hermes' })).toBeDisabled()

    // Ask: chat placeholder and button, no tags, no capture caption.
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByPlaceholderText('Ask Hermes anything…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask Hermes' })).toBeInTheDocument()
    expect(screen.queryByText('#idea')).toBeNull()
    expect(screen.queryByText(/Lands in the agent's inbox/)).toBeNull()

    // Back to Note: everything returns.
    await userEvent.click(screen.getByRole('button', { name: 'Note' }))
    expect(screen.getByPlaceholderText("What's on your mind?")).toBeInTheDocument()
    expect(screen.getByText('#idea')).toBeInTheDocument()
  })
})

describe('Capture command mode', () => {
  it('queues an adhoc digest only after the confirm dialog', async () => {
    const postCommand = vi.fn((_req: unknown) =>
      Promise.resolve({ status: 'ok', commandId: 'cmd-1' }),
    )
    renderCapture({ postCommand } as unknown as Partial<DataSource>)

    await userEvent.click(screen.getByRole('button', { name: 'Command' }))

    // Digest is the default type; no note affordances in command mode.
    expect(screen.getByRole('button', { name: 'Digest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Person note' })).toBeInTheDocument()
    expect(screen.queryByText('#idea')).toBeNull()

    const queueButton = screen.getByRole('button', { name: 'Queue command' })
    expect(queueButton).toBeDisabled()

    await userEvent.type(
      screen.getByPlaceholderText('What should the digest cover?'),
      'Portland flat market',
    )
    expect(queueButton).toBeEnabled()
    await userEvent.click(queueButton)

    // Nothing is sent until the user confirms.
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/next run/i)
    expect(postCommand).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Queue' }))
    expect(postCommand).toHaveBeenCalledTimes(1)
    const req = postCommand.mock.calls[0]?.[0] as {
      clientId: string
      type: string
      payload: { topic: string }
    }
    expect(req.type).toBe('adhoc-digest')
    expect(req.payload).toEqual({ topic: 'Portland flat market' })
    expect(req.clientId.length).toBeGreaterThanOrEqual(8)

    expect(await screen.findByText('Command queued')).toBeInTheDocument()
    // The composer resets for the next command.
    expect(screen.getByPlaceholderText('What should the digest cover?')).toHaveValue('')
  })

  it('cancel keeps the draft and sends nothing', async () => {
    const postCommand = vi.fn(() => Promise.resolve({ status: 'ok', commandId: 'cmd-1' }))
    renderCapture({ postCommand } as unknown as Partial<DataSource>)

    await userEvent.click(screen.getByRole('button', { name: 'Command' }))
    await userEvent.type(screen.getByPlaceholderText('What should the digest cover?'), 'topic')
    await userEvent.click(screen.getByRole('button', { name: 'Queue command' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(postCommand).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('What should the digest cover?')).toHaveValue('topic')
  })

  it('queues a person note with its fields, omitting a blank title', async () => {
    const postCommand = vi.fn((_req: unknown) =>
      Promise.resolve({ status: 'ok', commandId: 'cmd-2' }),
    )
    renderCapture({ postCommand } as unknown as Partial<DataSource>)

    await userEvent.click(screen.getByRole('button', { name: 'Command' }))
    await userEvent.click(screen.getByRole('button', { name: 'Person note' }))

    const queueButton = screen.getByRole('button', { name: 'Queue command' })
    await userEvent.type(screen.getByPlaceholderText('What should the note say?'), 'Owes me a book.')
    expect(queueButton).toBeDisabled() // person is required
    await userEvent.type(screen.getByPlaceholderText('Who is it about?'), 'Maria')
    expect(queueButton).toBeEnabled()

    await userEvent.click(queueButton)
    await userEvent.click(screen.getByRole('button', { name: 'Queue' }))

    expect(postCommand).toHaveBeenCalledTimes(1)
    const req = postCommand.mock.calls[0]?.[0] as { type: string; payload: Record<string, unknown> }
    expect(req.type).toBe('create-note')
    expect(req.payload).toEqual({ target: 'people', person: 'Maria', text: 'Owes me a book.' })
  })

  it('falls back to the offline queue when the agent is unreachable', async () => {
    const postCommand = vi.fn(() => Promise.reject(new Error('offline')))
    const { queue } = renderCapture({ postCommand } as unknown as Partial<DataSource>)

    await userEvent.click(screen.getByRole('button', { name: 'Command' }))
    await userEvent.type(screen.getByPlaceholderText('What should the digest cover?'), 'topic')
    await userEvent.click(screen.getByRole('button', { name: 'Queue command' }))
    await userEvent.click(screen.getByRole('button', { name: 'Queue' }))

    expect(await screen.findByText('Command queued')).toBeInTheDocument()
    expect(await queue.count()).toBe(1)
    const [queued] = await queue.peek()
    expect(queued?.kind).toBe('command')
    // The queued request carries the clientId minted before the first
    // attempt, so the eventual replay dedups server-side.
    expect(queued?.kind === 'command' && queued.req.clientId.length >= 8).toBe(true)
  })
})
