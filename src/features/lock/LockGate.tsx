import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { preferencesKV } from '@/data/kv'
import { hasPin, setPin, verifyPin } from '@/lib/pin'
import { useSettings } from '@/settings/SettingsProvider'
import { biometricAuthenticate, biometryAvailable } from './biometric'
import { PinPad } from './PinPad'

/** Relock after this much time in the background. */
const RELOCK_AFTER_MS = 30_000

interface AuthContextValue {
  /**
   * Confirm the user's identity for a sensitive action (biometric first,
   * PIN pad fallback). Resolves true when confirmed.
   */
  requestAuth: (reason: string) => Promise<boolean>
  /** Guided PIN creation (enter twice). Resolves true when a PIN was set. */
  setupPin: () => Promise<boolean>
  pinConfigured: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

type PinModal =
  | { mode: 'verify'; reason: string; resolve: (ok: boolean) => void; error?: string }
  | { mode: 'create'; first?: string; resolve: (ok: boolean) => void; error?: string }

export function LockGate({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [locked, setLocked] = useState(settings.appLock)
  const [unlockError, setUnlockError] = useState(false)
  const [pinConfigured, setPinConfigured] = useState(false)
  const [pinModal, setPinModal] = useState<PinModal | null>(null)
  const [lockPinMode, setLockPinMode] = useState(false)
  const backgroundedAt = useRef<number | null>(null)
  const unlockAttempted = useRef(false)

  useEffect(() => {
    void hasPin(preferencesKV).then(setPinConfigured)
  }, [])

  // Relock when returning from a long background stay.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundedAt.current = Date.now()
        return
      }
      const away = backgroundedAt.current === null ? 0 : Date.now() - backgroundedAt.current
      if (settings.appLock && away > RELOCK_AFTER_MS) {
        unlockAttempted.current = false
        setLockPinMode(false)
        setLocked(true)
      }
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [settings.appLock])

  const tryBiometricUnlock = useCallback(async () => {
    setUnlockError(false)
    if (await biometryAvailable()) {
      if (await biometricAuthenticate('Unlock Hermes Lens')) {
        setLocked(false)
        return
      }
      setUnlockError(true)
    }
    // No biometry (or it failed): fall back to the PIN pad when one exists.
    if (await hasPin(preferencesKV)) setLockPinMode(true)
    else if (!(await biometryAvailable())) setLocked(false) // lock on, but no method set up
  }, [])

  // Auto-prompt once when the lock screen appears.
  useEffect(() => {
    if (locked && !unlockAttempted.current) {
      unlockAttempted.current = true
      void tryBiometricUnlock()
    }
  }, [locked, tryBiometricUnlock])

  const requestAuth = useCallback(
    async (reason: string): Promise<boolean> => {
      if (await biometryAvailable()) {
        if (await biometricAuthenticate(reason)) return true
      }
      if (!(await hasPin(preferencesKV))) {
        // Fail closed: with no biometry and no PIN, sensitive data stays
        // hidden until the user sets a PIN right here.
        const created = await new Promise<boolean>((resolve) => {
          setPinModal({ mode: 'create', resolve })
        })
        if (created) setPinConfigured(true)
        return created
      }
      return new Promise<boolean>((resolve) => {
        setPinModal({ mode: 'verify', reason, resolve })
      })
    },
    [],
  )

  const setupPin = useCallback(async (): Promise<boolean> => {
    const ok = await new Promise<boolean>((resolve) => {
      setPinModal({ mode: 'create', resolve })
    })
    if (ok) setPinConfigured(true)
    return ok
  }, [])

  const handlePinEntry = useCallback(
    async (pin: string) => {
      if (pinModal === null) return
      if (pinModal.mode === 'verify') {
        if (await verifyPin(preferencesKV, pin)) {
          pinModal.resolve(true)
          setPinModal(null)
        } else {
          setPinModal({ ...pinModal, error: 'Wrong PIN, try again' })
        }
        return
      }
      // create mode: ask twice
      if (pinModal.first === undefined) {
        setPinModal({ mode: 'create', first: pin, resolve: pinModal.resolve })
      } else if (pinModal.first === pin) {
        await setPin(preferencesKV, pin)
        pinModal.resolve(true)
        setPinModal(null)
      } else {
        setPinModal({ mode: 'create', resolve: pinModal.resolve, error: 'PINs differ — start over' })
      }
    },
    [pinModal],
  )

  const value = useMemo(
    () => ({ requestAuth, setupPin, pinConfigured }),
    [requestAuth, setupPin, pinConfigured],
  )

  if (locked && settings.appLock) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-10 px-8">
        <div className="flex flex-col items-center gap-3">
          <div className="border-accent/40 text-accent flex h-16 w-16 items-center justify-center rounded-2xl border text-3xl">
            ◈
          </div>
          <div className="text-lg font-semibold tracking-tight">Hermes Lens</div>
          <div className="text-xs text-faint">Locked</div>
        </div>
        {lockPinMode ? (
          <PinPad
            title="Enter PIN"
            onComplete={(pin) => {
              void verifyPin(preferencesKV, pin).then((ok) => {
                if (ok) {
                  setLockPinMode(false)
                  setLocked(false)
                  setUnlockError(false)
                } else setUnlockError(true)
              })
            }}
            {...(unlockError ? { error: 'Wrong PIN' } : {})}
          />
        ) : (
          <div className="flex flex-col items-center gap-3">
            {unlockError && <div className="text-danger text-xs">Authentication failed</div>}
            <button
              onClick={() => void tryBiometricUnlock()}
              className="bg-accent text-accent-ink rounded-full px-8 py-3 text-sm font-semibold active:opacity-80"
            >
              Unlock
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {pinModal !== null && (
        <div className="bg-bg/95 fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 px-8 backdrop-blur-sm">
          <PinPad
            title={
              pinModal.mode === 'verify'
                ? pinModal.reason
                : pinModal.first === undefined
                  ? 'Choose a 6-digit PIN'
                  : 'Repeat the PIN'
            }
            onComplete={(pin) => void handlePinEntry(pin)}
            {...(pinModal.error !== undefined ? { error: pinModal.error } : {})}
          />
          <button
            onClick={() => {
              pinModal.resolve(false)
              setPinModal(null)
            }}
            className="text-sm text-faint active:opacity-70"
          >
            Cancel
          </button>
        </div>
      )}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (ctx === null) throw new Error('useAuth outside LockGate')
  return ctx
}
