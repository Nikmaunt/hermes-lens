// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/App'
import { preferencesKV } from '@/data/kv'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

// App boots (first-run gate + mock latency) make these slower than the 5 s default.
const TEST_TIMEOUT = 20_000

// jsdom keeps localStorage across tests in this file — start each boot fresh
// so the first-run gate and the notification defaults are deterministic.
beforeEach(() => {
  localStorage.clear()
})

async function bootToSettings() {
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
  await userEvent.click(await screen.findByText('Settings', undefined, { timeout: 5000 }))
  await screen.findByText('Notification capture', undefined, { timeout: 5000 })
}

async function readNotifConfig(): Promise<unknown> {
  const raw = await preferencesKV.get('notif:config')
  return raw === null ? null : JSON.parse(raw)
}

describe('Settings → Notification capture', () => {
  it(
    'toggling on shows the explainer first; Continue enables and writes notif:config',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSettings()

      const toggle = screen.getByRole('switch', { name: /capture app notifications/i })
      expect(toggle.getAttribute('aria-checked')).toBe('false')

      await userEvent.click(toggle)
      // Explainer overlay before anything is enabled (calendar pattern).
      expect(await screen.findByText('Notifications into Hermes')).toBeInTheDocument()
      expect(toggle.getAttribute('aria-checked')).toBe('false')

      await userEvent.click(screen.getByText('Continue'))
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
      await waitFor(async () =>
        expect(await readNotifConfig()).toEqual({ enabled: true, allowlist: [], v: 1 }),
      )
    },
  )

  it(
    '"Not now" keeps capture off — notif:config never says enabled',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSettings()

      const toggle = screen.getByRole('switch', { name: /capture app notifications/i })
      await userEvent.click(toggle)
      await userEvent.click(await screen.findByText('Not now'))

      expect(toggle.getAttribute('aria-checked')).toBe('false')
      // Earlier settings saves (the demo-mode choice) already mirrored the
      // config — but it must still read disabled.
      const config = await readNotifConfig()
      expect(config === null || (config as { enabled: boolean }).enabled === false).toBe(true)
    },
  )

  it(
    'the allowlist accepts package names, rejects junk, and mirrors every change to notif:config',
    { timeout: TEST_TIMEOUT },
    async () => {
      await bootToSettings()

      // Enable capture first — the allowlist editor lives under the toggle.
      await userEvent.click(screen.getByRole('switch', { name: /capture app notifications/i }))
      await userEvent.click(await screen.findByText('Continue'))

      const input = await screen.findByPlaceholderText('com.whatsapp')

      // Junk is rejected: no row appears, config stays empty.
      await userEvent.type(input, 'WhatsApp notifications')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(await screen.findByText(/doesn.t look like a package name/i)).toBeInTheDocument()
      expect(screen.queryByText('WhatsApp notifications')).toBeNull()

      // A real package name lands in the list and in notif:config.
      await userEvent.clear(input)
      await userEvent.type(input, 'org.telegram.messenger')
      await userEvent.click(screen.getByRole('button', { name: 'Add' }))
      expect(await screen.findByText('org.telegram.messenger')).toBeInTheDocument()
      await waitFor(async () =>
        expect(await readNotifConfig()).toEqual({
          enabled: true,
          allowlist: ['org.telegram.messenger'],
          v: 1,
        }),
      )

      // Removing it mirrors the change too.
      await userEvent.click(
        screen.getByRole('button', { name: 'Remove org.telegram.messenger' }),
      )
      expect(screen.queryByText('org.telegram.messenger')).toBeNull()
      await waitFor(async () =>
        expect(await readNotifConfig()).toEqual({ enabled: true, allowlist: [], v: 1 }),
      )
    },
  )
})
