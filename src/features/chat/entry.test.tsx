// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'

// RTL auto-cleanup never registers here (no injected globals); do it by hand.
afterEach(cleanup)

const TIMEOUT = 20_000

async function bootToToday() {
  // jsdom keeps the URL across tests; every boot starts from the root.
  window.history.replaceState({}, '', '/')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
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
  await waitFor(() => expect(screen.getByText('Open follow-ups')).toBeInTheDocument(), {
    timeout: 5000,
  })
  return utils
}

describe('chat entry points', () => {
  it('opens /chat from the unconditional "Ask Hermes" card on Today', async () => {
    await bootToToday()
    await userEvent.click(screen.getByText('Ask Hermes'))
    await waitFor(() => expect(screen.getByPlaceholderText('Ask Hermes…')).toBeInTheDocument())
  }, TIMEOUT)

  it('Capture defaults to Note; the Ask toggle hides capture chrome and hands the question to /chat', async () => {
    const { container } = await bootToToday()
    await userEvent.click(container.querySelector('a[href="/capture"]') as Element)

    // Default is Note: the offline/queue caption is present, the action captures.
    await screen.findByPlaceholderText("What's on your mind?", undefined, { timeout: 5000 })
    expect(screen.getByText(/Works offline/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to Hermes' })).toBeInTheDocument()

    // Switch to Ask: capture-specific chrome disappears, the action re-labels.
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.queryByText(/Works offline/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send to Hermes' })).toBeNull()

    // Compose a question and send it → it hands off to /chat and starts the turn.
    await userEvent.type(screen.getByPlaceholderText('Ask Hermes anything…'), 'Who am I?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask Hermes' }))
    await waitFor(() => expect(screen.getByText('Who am I?')).toBeInTheDocument(), { timeout: 5000 })
    // We are on the chat screen (its composer), not capture.
    expect(screen.getByPlaceholderText('Ask Hermes…')).toBeInTheDocument()
  }, TIMEOUT)
})
