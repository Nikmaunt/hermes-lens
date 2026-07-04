import { useState } from 'react'
import { Screen } from '@/components/Screen'
import { Card, SectionHeader } from '@/components/primitives'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useData } from '@/data/DataSourceProvider'
import { preferencesKV } from '@/data/kv'
import { clearPin } from '@/lib/pin'
import { TriageDestination } from '@/schemas'
import { useSettings } from '@/settings/SettingsProvider'
import type { SwipeMapping } from '@/settings/settings'
import { biometryAvailable } from '../lock/biometric'
import { useAuth } from '../lock/LockGate'

const DIRECTIONS: { key: keyof SwipeMapping; label: string; arrow: string }[] = [
  { key: 'right', label: 'Swipe right', arrow: '→' },
  { key: 'left', label: 'Swipe left', arrow: '←' },
  { key: 'up', label: 'Swipe up', arrow: '↑' },
  { key: 'down', label: 'Swipe down', arrow: '↓' },
]

export function SettingsScreen() {
  const { settings, apiToken, update, updateApiToken } = useSettings()
  const { pendingCount, queue, ds } = useData()
  const { setupPin, pinConfigured } = useAuth()
  const snackbar = useSnackbar()
  const [showToken, setShowToken] = useState(false)

  const toggleLock = async (enabled: boolean) => {
    if (!enabled) {
      update({ appLock: false })
      return
    }
    // Make sure at least one unlock method exists before locking the door.
    if (!(await biometryAvailable()) && !pinConfigured) {
      const created = await setupPin()
      if (!created) {
        snackbar.show({ message: 'App lock needs biometrics or a PIN' })
        return
      }
    }
    update({ appLock: true })
  }

  const syncNow = async () => {
    const flushed = await queue.drain(ds)
    snackbar.show({
      message:
        flushed > 0
          ? `Synced ${flushed} queued action${flushed === 1 ? '' : 's'}`
          : pendingCount > 0
            ? 'Still unreachable — kept in the queue'
            : 'Nothing to sync',
    })
  }

  return (
    <Screen title="Settings" back noSearch>
      <SectionHeader>Data source</SectionHeader>
      <Card className="space-y-4">
        <div className="flex gap-1 rounded-xl bg-raised p-1">
          {(['mock', 'api'] as const).map((source) => (
            <button
              key={source}
              onClick={() => update({ source })}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                settings.source === source ? 'bg-surface text-ink shadow' : 'text-faint'
              }`}
            >
              {source === 'mock' ? 'Mock data' : 'Agent API'}
            </button>
          ))}
        </div>
        {settings.source === 'api' && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                Base URL (Tailscale)
              </span>
              <input
                value={settings.apiBaseUrl}
                onChange={(e) => update({ apiBaseUrl: e.target.value.trim() })}
                placeholder="http://hermes-vps:8787"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Bearer token</span>
              <div className="flex gap-2">
                <input
                  value={apiToken}
                  onChange={(e) => updateApiToken(e.target.value.trim())}
                  type={showToken ? 'text' : 'password'}
                  placeholder="paste the static token"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full flex-1 rounded-lg border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent"
                />
                <button
                  onClick={() => setShowToken((v) => !v)}
                  className="rounded-lg border border-line px-3 text-xs text-muted active:bg-raised"
                >
                  {showToken ? 'hide' : 'show'}
                </button>
              </div>
              <span className="mt-1 block text-[11px] text-faint">
                Stored in Android Keystore-backed encrypted storage, on-device only. Never
                logged, never leaves the Tailscale network.
              </span>
            </label>
          </>
        )}
      </Card>

      <SectionHeader>Offline queue</SectionHeader>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">
              {pendingCount === 0
                ? 'All actions synced'
                : `${pendingCount} action${pendingCount === 1 ? '' : 's'} pending`}
            </div>
            <div className="mt-0.5 text-[11px] text-faint">
              captures, triage and flag requests made while offline
            </div>
          </div>
          {pendingCount > 0 && (
            <button
              onClick={() => void syncNow()}
              className="bg-accent-dim text-accent rounded-full px-4 py-1.5 text-xs font-semibold active:opacity-70"
            >
              Sync now
            </button>
          )}
        </div>
      </Card>

      <SectionHeader>Security</SectionHeader>
      <Card className="divide-y divide-line p-0">
        <ToggleRow
          label="App lock"
          hint="biometric on open, PIN fallback"
          checked={settings.appLock}
          onChange={(v) => void toggleLock(v)}
        />
        <div className="flex items-center justify-between px-4 py-3.5">
          <div>
            <div className="text-sm font-medium">PIN</div>
            <div className="mt-0.5 text-[11px] text-faint">
              {pinConfigured ? 'configured' : 'not set'}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void setupPin()}
              className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted active:bg-raised"
            >
              {pinConfigured ? 'Change' : 'Set up'}
            </button>
            {pinConfigured && !settings.appLock && (
              <button
                onClick={() => {
                  void clearPin(preferencesKV).then(() => window.location.reload())
                }}
                className="text-danger rounded-full border border-line px-3 py-1.5 text-xs font-medium active:bg-raised"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </Card>

      <SectionHeader>Appearance</SectionHeader>
      <Card className="p-0">
        <ToggleRow
          label="Light theme"
          hint="dark is the default"
          checked={settings.theme === 'light'}
          onChange={(v) => update({ theme: v ? 'light' : 'dark' })}
        />
      </Card>

      <SectionHeader>Inbox swipe mapping</SectionHeader>
      <Card className="divide-y divide-line p-0">
        {DIRECTIONS.map(({ key, label, arrow }) => (
          <div key={key} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">
              <span className="mr-2 inline-block w-4 text-center text-faint">{arrow}</span>
              {label}
            </span>
            <select
              value={settings.swipeMapping[key]}
              onChange={(e) =>
                update({
                  swipeMapping: {
                    ...settings.swipeMapping,
                    [key]: TriageDestination.parse(e.target.value),
                  },
                })
              }
              className="rounded-lg border border-line bg-raised px-2 py-1.5 text-sm outline-none"
            >
              {TriageDestination.options.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        ))}
      </Card>

      <p className="mt-8 text-center text-[11px] text-faint">
        Hermes Lens · private build · no telemetry, ever
      </p>
    </Screen>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] text-faint">{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`h-7 w-12 rounded-full p-1 transition-colors ${
          checked ? 'bg-accent' : 'bg-raised'
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  )
}
