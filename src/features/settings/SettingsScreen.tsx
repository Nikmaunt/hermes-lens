import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Screen } from '@/components/Screen'
import { Card, ConfirmDialog, SectionHeader } from '@/components/primitives'
import { BellIcon, CalendarIcon } from '@/components/icons'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useData } from '@/data/DataSourceProvider'
import { getValidationLog, onValidationLogChange, type ValidationLogEntry } from '@/data/debugLog'
import { preferencesKV } from '@/data/kv'
import type { DeadLetter, QueuedMutation } from '@/data/mutationQueue'
import { relativeTime } from '@/lib/dates'
import { clearPin } from '@/lib/pin'
import { TriageDestination } from '@/schemas'
import { useSettings } from '@/settings/SettingsProvider'
import type { SwipeMapping } from '@/settings/settings'
import { biometryAvailable } from '../lock/biometric'
import { useAuth } from '../lock/LockGate'
import { CalendarBridge, type DeviceCalendar } from '../reminders/calendarBridge'
import { NotifBridge } from '../notifications/notifBridge'
import { looksLikePackageName } from '../notifications/notifConfig'

/** One-line human description of a queued mutation for the dead-letter list. */
function describeMutation(item: QueuedMutation): string {
  if (item.kind === 'capture') {
    const text = item.req.text.length > 60 ? `${item.req.text.slice(0, 60)}…` : item.req.text
    return `Capture: “${text}”`
  }
  if (item.kind === 'triage') return `Triage ${item.itemId} → ${item.req.destination}`
  if (item.kind === 'flag') return `Flag ${item.itemId}: ${item.req.action}`
  if (item.kind === 'followup-action')
    return `Follow-up ${item.itemId}: ${
      item.req.action === 'snooze'
        ? `snooze until ${item.req.until ?? '?'}`
        : item.req.action === 'someday'
          ? 'to someday'
          : 'done'
    }`
  if (item.kind === 'habit-tick') return `Habit ${item.itemId}: tick ${item.req.date}`
  if (item.kind === 'followup-undo') return `Follow-up ${item.itemId}: undo`
  if (item.kind === 'habit-undo') return `Habit ${item.itemId}: undo tick ${item.req.date}`
  if (item.kind === 'untriage') return `Inbox ${item.itemId}: undo triage`
  if (item.kind === 'someday-action')
    return `Someday ${item.itemId}: ${
      item.req.action === 'activate' ? `activate on ${item.req.date}` : 'close'
    }`
  if (item.kind === 'someday-undo') return `Someday ${item.itemId}: undo`
  if (item.kind === 'notification') {
    const title = item.req.title.length > 40 ? `${item.req.title.slice(0, 40)}…` : item.req.title
    return `Notification from ${item.req.package}${title === '' ? '' : `: “${title}”`}`
  }
  return `Calendar sync ack (${item.req.lastSeenRevision})`
}

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
  const [confirm, setConfirm] = useState<
    { kind: 'remove-pin' } | { kind: 'discard-dead-letter'; id: string } | null
  >(null)
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([])
  const [validationLog, setValidationLog] = useState<readonly ValidationLogEntry[]>(
    getValidationLog(),
  )

  useEffect(() => {
    const refresh = () => void queue.deadLetters().then(setDeadLetters)
    refresh()
    return queue.onDeadLetterChange(refresh)
  }, [queue])

  useEffect(() => onValidationLogChange(() => setValidationLog([...getValidationLog()])), [])

  const [calendarExplainer, setCalendarExplainer] = useState(false)
  const [deviceCalendars, setDeviceCalendars] = useState<DeviceCalendar[]>([])

  useEffect(() => {
    if (!settings.calendarSyncEnabled || !Capacitor.isNativePlatform()) return
    void CalendarBridge.listCalendars()
      .then(({ calendars }) => setDeviceCalendars(calendars))
      .catch(() => setDeviceCalendars([]))
  }, [settings.calendarSyncEnabled])

  const toggleCalendarSync = (enabled: boolean) => {
    if (!enabled) {
      update({ calendarSyncEnabled: false })
      return
    }
    if (!Capacitor.isNativePlatform()) {
      snackbar.show({ message: 'Calendar sync works on the phone build' })
      return
    }
    // Designed pre-permission explainer before the system dialog.
    setCalendarExplainer(true)
  }

  const confirmCalendarSync = async () => {
    setCalendarExplainer(false)
    try {
      const perm = await CalendarBridge.requestPermissions()
      if (perm.calendar !== 'granted') {
        snackbar.show({ message: 'Calendar permission was declined — sync stays off' })
        return
      }
      update({ calendarSyncEnabled: true })
      snackbar.show({ message: 'Reminders will appear in your calendar on the next refresh' })
    } catch {
      snackbar.show({ message: 'Calendar access unavailable on this device' })
    }
  }

  const [notifExplainer, setNotifExplainer] = useState(false)
  const [newPackage, setNewPackage] = useState('')
  const [packageError, setPackageError] = useState(false)

  const toggleNotificationCapture = (enabled: boolean) => {
    if (!enabled) {
      update({ notificationCaptureEnabled: false })
      return
    }
    // Designed pre-permission explainer before the system screen (calendar pattern).
    setNotifExplainer(true)
  }

  const confirmNotificationCapture = async () => {
    setNotifExplainer(false)
    // Enable first: the setting (mirrored to notif:config) must be in place
    // whether or not the system screen round-trip works on this build.
    update({ notificationCaptureEnabled: true })
    try {
      await NotifBridge.openSystemSettings()
    } catch {
      // Bridge unavailable (browser, or the listener service ships next
      // release) — the stored config takes effect once it exists.
    }
  }

  const addAllowlistPackage = () => {
    const pkg = newPackage.trim()
    if (!looksLikePackageName(pkg)) {
      setPackageError(true)
      return
    }
    setPackageError(false)
    setNewPackage('')
    if (!settings.notificationAllowlist.includes(pkg)) {
      update({ notificationAllowlist: [...settings.notificationAllowlist, pkg] })
    }
  }

  const removeAllowlistPackage = (pkg: string) => {
    update({ notificationAllowlist: settings.notificationAllowlist.filter((p) => p !== pkg) })
  }

  const retryDeadLetter = async (id: string) => {
    await queue.retryDeadLetter(id)
    const flushed = await queue.drain(ds)
    snackbar.show({
      message: flushed > 0 ? 'Sent ✓' : 'Requeued — still failing, kept in the queue',
    })
  }

  const discardDeadLetter = async (id: string) => {
    await queue.discardDeadLetter(id)
    snackbar.show({ message: 'Action discarded' })
  }

  const removePin = () => {
    void clearPin(preferencesKV).then(() => window.location.reload())
  }

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
                settings.source === source ? 'bg-surface text-ink shadow' : 'text-muted'
              }`}
            >
              {source === 'mock' ? 'Demo mode' : 'Agent API'}
            </button>
          ))}
        </div>
        {settings.source === 'mock' && (
          <p className="text-xs text-warn">
            Demo mode — every screen shows bundled sample data, marked with a DEMO badge.
            Nothing is real and nothing syncs.
          </p>
        )}
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
                className="w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent focus-visible:outline-none"
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
                  className="w-full flex-1 rounded-lg border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent focus-visible:outline-none"
                />
                <button
                  onClick={() => setShowToken((v) => !v)}
                  className="rounded-lg border border-line px-3 text-xs text-muted active:bg-raised"
                >
                  {showToken ? 'hide' : 'show'}
                </button>
              </div>
              <span className="mt-1 block text-caption text-faint">
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
            <div className="mt-0.5 text-caption text-faint">
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

      <SectionHeader>Calendar</SectionHeader>
      <Card className="p-0">
        <ToggleRow
          label="Sync reminders to calendar"
          hint="agent deadlines appear as events, refreshed while the app is open"
          checked={settings.calendarSyncEnabled}
          onChange={toggleCalendarSync}
        />
        {settings.calendarSyncEnabled && (
          <div className="border-t border-line px-4 py-3.5">
            <span className="mb-1 block text-xs font-medium text-muted">Target calendar</span>
            <select
              value={settings.calendarTargetId}
              onChange={(e) => update({ calendarTargetId: e.target.value })}
              className="w-full rounded-lg border border-line bg-raised px-2 py-2 text-sm outline-none"
            >
              <option value="">Hermes — stays on this device</option>
              {deviceCalendars
                .filter((cal) => !(cal.isLocal && cal.name === 'Hermes'))
                .map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name} ({cal.account})
                  </option>
                ))}
            </select>
            <p className="mt-2 text-caption text-faint">
              Account calendars (Google, Samsung…) upload event titles to that provider's
              cloud. The local Hermes calendar never leaves the phone.
            </p>
          </div>
        )}
      </Card>

      <SectionHeader>Notification capture</SectionHeader>
      <Card className="p-0">
        <ToggleRow
          label="Capture app notifications"
          hint="allowed apps' notifications flow into the agent's inbox (phone build)"
          checked={settings.notificationCaptureEnabled}
          onChange={toggleNotificationCapture}
        />
        {settings.notificationCaptureEnabled && (
          <div className="border-t border-line px-4 py-3.5">
            <span className="mb-1 block text-xs font-medium text-muted">Allowed apps</span>
            {settings.notificationAllowlist.length === 0 ? (
              <p className="mb-2 text-caption text-faint">
                No apps allowed yet — nothing is captured until you add one.
              </p>
            ) : (
              <ul className="mb-2 divide-y divide-line">
                {settings.notificationAllowlist.map((pkg) => (
                  <li key={pkg} className="flex items-center justify-between gap-3 py-2">
                    {/* min-w-0 + break-all: a long monospace package name
                        (com.google.android.apps.walletnfcrel) wraps onto a
                        second line instead of pushing Remove off a 375px
                        screen. */}
                    <span className="min-w-0 flex-1 font-mono text-xs break-all">{pkg}</span>
                    <button
                      aria-label={`Remove ${pkg}`}
                      onClick={() => removeAllowlistPackage(pkg)}
                      className="text-danger relative shrink-0 rounded-full border border-line px-3 py-1 text-xs font-medium active:bg-raised before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                value={newPackage}
                onChange={(e) => {
                  setNewPackage(e.target.value)
                  setPackageError(false)
                }}
                placeholder="com.whatsapp"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full flex-1 rounded-lg border border-line bg-raised px-3 py-2.5 font-mono text-sm outline-none placeholder:text-faint focus:border-accent focus-visible:outline-none"
              />
              <button
                onClick={addAllowlistPackage}
                className="bg-accent-dim text-accent rounded-lg px-4 text-xs font-semibold active:opacity-70"
              >
                Add
              </button>
            </div>
            {packageError && (
              <p className="mt-1 text-caption text-warn">
                Doesn't look like a package name — expected something like com.whatsapp
              </p>
            )}
            <p className="mt-2 text-caption text-faint">
              Only notifications from these apps are captured. The list is stored on-device
              and read by the listener service.
            </p>
          </div>
        )}
      </Card>

      {deadLetters.length > 0 && (
        <>
          <SectionHeader>Failed actions</SectionHeader>
          <Card className="divide-y divide-line p-0">
            {deadLetters.map((dead) => (
              <div key={dead.item.id} className="px-4 py-3">
                <div className="text-sm">{describeMutation(dead.item)}</div>
                <div className="mt-0.5 text-caption text-faint">
                  {dead.reason} · {relativeTime(dead.failedAt)}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void retryDeadLetter(dead.item.id)}
                    className="bg-accent-dim text-accent rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-70"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => setConfirm({ kind: 'discard-dead-letter', id: dead.item.id })}
                    className="text-danger rounded-full border border-line px-3 py-1.5 text-xs font-medium active:bg-raised"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

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
            <div className="mt-0.5 text-caption text-faint">
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
                onClick={() => setConfirm({ kind: 'remove-pin' })}
                className="text-danger rounded-full border border-line px-3 py-1.5 text-xs font-medium active:bg-raised"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <ToggleRow
          label="Hide widget details when locked"
          hint="home-screen widget shows no counts or deadlines while app lock is on"
          checked={settings.widgetHideDetails}
          onChange={(v) => update({ widgetHideDetails: v })}
        />
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

      {validationLog.length > 0 && (
        <>
          <SectionHeader>Debug — invalid payloads</SectionHeader>
          <Card className="divide-y divide-line p-0">
            {validationLog.map((entry, i) => (
              <div key={`${entry.at}-${i}`} className="px-4 py-3">
                <div className="font-mono text-xs">{entry.path}</div>
                <div className="mt-0.5 text-caption text-faint">{relativeTime(entry.at)}</div>
                <ul className="mt-1 space-y-0.5">
                  {entry.issues.slice(0, 5).map((issue, j) => (
                    <li key={j} className="font-mono text-caption text-warn">
                      {issue}
                    </li>
                  ))}
                  {entry.issues.length > 5 && (
                    <li className="text-caption text-faint">+{entry.issues.length - 5} more</li>
                  )}
                </ul>
              </div>
            ))}
          </Card>
          <p className="mt-2 px-1 text-caption text-faint">
            The agent answered, but the payload didn't match the contract. In-memory only,
            cleared on restart.
          </p>
        </>
      )}

      <p className="mt-8 text-center text-caption text-faint">
        Hermes Lens · private build · no telemetry, ever
      </p>

      {confirm !== null && (
        <ConfirmDialog
          title={confirm.kind === 'remove-pin' ? 'Remove the PIN?' : 'Discard this action?'}
          body={
            confirm.kind === 'remove-pin'
              ? 'Sensitive memory and app lock will have no PIN fallback until you set a new one.'
              : 'The action was rejected by the agent and will be dropped for good — it never reached the server.'
          }
          confirmLabel={confirm.kind === 'remove-pin' ? 'Remove PIN' : 'Discard'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm.kind === 'remove-pin') removePin()
            else void discardDeadLetter(confirm.id)
            setConfirm(null)
          }}
        />
      )}

      {notifExplainer && (
        <div className="bg-bg/95 fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-8 backdrop-blur-sm">
          <div className="text-faint">
            <BellIcon size={30} />
          </div>
          <div className="max-w-72 space-y-3 text-center">
            <h2 className="text-lg font-semibold">Notifications into Hermes</h2>
            <p className="text-sm text-muted">
              Hermes reads notifications from the apps you allow and files them into the
              agent's inbox, so a chat ping never gets lost.
            </p>
            <p className="text-xs text-faint">
              Android will now open the notification-access settings — grant access to
              Hermes Lens there. Only allowed apps are captured, and nothing leaves the
              Tailscale network.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => void confirmNotificationCapture()}
              className="bg-accent text-accent-ink rounded-full px-8 py-3 text-sm font-semibold active:opacity-80"
            >
              Continue
            </button>
            <button
              onClick={() => setNotifExplainer(false)}
              className="text-sm text-faint active:opacity-70"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {calendarExplainer && (
        <div className="bg-bg/95 fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-8 backdrop-blur-sm">
          <div className="text-faint">
            <CalendarIcon size={30} />
          </div>
          <div className="max-w-72 space-y-3 text-center">
            <h2 className="text-lg font-semibold">Reminders in your calendar</h2>
            <p className="text-sm text-muted">
              Hermes mirrors the agent's dated commitments into a calendar so they show up
              next to everything else — by default a local “Hermes” calendar that stays on
              this device.
            </p>
            <p className="text-xs text-faint">
              Android will now ask for calendar access. Hermes only touches events it created
              and only while the app is open — no background work, ever.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => void confirmCalendarSync()}
              className="bg-accent text-accent-ink rounded-full px-8 py-3 text-sm font-semibold active:opacity-80"
            >
              Continue
            </button>
            <button
              onClick={() => setCalendarExplainer(false)}
              className="text-sm text-faint active:opacity-70"
            >
              Not now
            </button>
          </div>
        </div>
      )}
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
        <div className="mt-0.5 text-caption text-faint">{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`h-7 w-12 shrink-0 rounded-full p-1 transition-colors ${
          checked ? 'bg-accent' : 'bg-control-track'
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full shadow transition-transform ${
            checked ? 'bg-accent-ink translate-x-5' : 'bg-control-thumb'
          }`}
        />
      </button>
    </div>
  )
}
