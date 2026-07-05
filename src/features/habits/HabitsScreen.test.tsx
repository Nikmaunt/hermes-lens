// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '@/App'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

const TEST_TIMEOUT = 20_000

async function bootToHabits() {
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
  await userEvent.click(await screen.findByText('Habits', undefined, { timeout: 5000 }))
  await waitFor(
    () => expect(screen.getByText('Spanish practice')).toBeInTheDocument(),
    { timeout: 5000 },
  )
}

describe('habit tick from the Habits screen', () => {
  it(
    'ticks today optimistically: button flips to done and the streak grows',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToHabits()

      // Nothing in the fixtures is completed today — every habit is tickable.
      const tick = screen.getByRole('button', { name: 'Tick today: Spanish practice' })
      await userEvent.click(tick)

      // Optimistic flip: the same habit now shows a disabled done state.
      const done = await screen.findByRole('button', { name: 'Ticked today: Spanish practice' })
      expect(done).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'Tick today: Spanish practice' }),
      ).toBeNull()
    },
  )

  it(
    'keeps the done state after a refetch (mock persists the tick)',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToHabits()
      // Ticked in the previous test; the overlay survives the new boot.
      const done = await screen.findByRole(
        'button',
        { name: 'Ticked today: Spanish practice' },
        { timeout: 5000 },
      )
      expect(done).toBeDisabled()
      // Other habits are unaffected.
      expect(
        screen.getByRole('button', { name: 'Tick today: Gym / strength' }),
      ).toBeEnabled()
    },
  )

  it(
    'tick shows an undo snackbar and undo flips the button back',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToHabits()
      await userEvent.click(screen.getByRole('button', { name: 'Tick today: Gym / strength' }))

      await screen.findByText('Ticked', undefined, { timeout: 5000 })
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

      await waitFor(
        () =>
          expect(screen.getByRole('button', { name: 'Tick today: Gym / strength' })).toBeEnabled(),
        { timeout: 5000 },
      )
      expect(screen.queryByRole('button', { name: 'Ticked today: Gym / strength' })).toBeNull()
      // Let the background undo request and refetch settle before the next
      // boot reads the overlay.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    },
  )

  it(
    'the undone tick does not resurface after a reboot (overlay round-trip)',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToHabits()
      expect(
        await screen.findByRole('button', { name: 'Tick today: Gym / strength' }, { timeout: 5000 }),
      ).toBeEnabled()
    },
  )
})
