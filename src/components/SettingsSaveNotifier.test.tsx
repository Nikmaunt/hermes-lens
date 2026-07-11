// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { preferencesKV } from '@/data/kv'
import { SettingsProvider, useSettings } from '@/settings/SettingsProvider'
import { SettingsSaveNotifier } from './SettingsSaveNotifier'
import { SnackbarProvider } from './SnackbarProvider'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Probe() {
  const { update, ready } = useSettings()
  if (!ready) return null
  return <button onClick={() => update({ theme: 'light' })}>flip theme</button>
}

function renderWithNotifier() {
  render(
    <SettingsProvider>
      <SnackbarProvider>
        <SettingsSaveNotifier />
        <Probe />
      </SnackbarProvider>
    </SettingsProvider>,
  )
}

describe('SettingsSaveNotifier', () => {
  it('warns and shows a snackbar when persisting settings fails', async () => {
    // A silent persist failure is a privacy boundary: "capture off" that
    // never reached the notif:config mirror means the native listener keeps
    // capturing while the UI claims otherwise.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const realSet = preferencesKV.set.bind(preferencesKV)
    vi.spyOn(preferencesKV, 'set').mockImplementation((key: string, value: string) =>
      key === 'settings' ? Promise.reject(new Error('disk full')) : realSet(key, value),
    )

    renderWithNotifier()
    await userEvent.click(await screen.findByText('flip theme'))

    expect(await screen.findByText('Settings may not have saved')).toBeInTheDocument()
    await waitFor(() => expect(warn).toHaveBeenCalled())
  })

  it('stays silent while saves succeed', async () => {
    renderWithNotifier()
    await userEvent.click(await screen.findByText('flip theme'))

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByText('Settings may not have saved')).toBeNull()
  })
})
