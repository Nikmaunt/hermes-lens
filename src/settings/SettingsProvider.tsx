import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { preferencesKV } from '@/data/kv'
import { secureKV } from '@/data/secureKV'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings'
import { loadApiToken, saveApiToken } from './tokenStore'

interface SettingsContextValue {
  settings: Settings
  /**
   * Bearer token — kept OUT of the settings object, in Keystore-backed
   * secure storage (see settings/tokenStore.ts for the migration contract).
   */
  apiToken: string
  /** True until settings + token are loaded from storage (first paint gate). */
  ready: boolean
  /**
   * Count of failed settings persists this session, for surfacing (the
   * snackbar lives inside SnackbarProvider, below this provider — see
   * SettingsSaveNotifier). A silent failure here is a privacy boundary:
   * "capture off" that never reached the notif:config mirror means the
   * native listener keeps capturing while the UI claims otherwise.
   */
  saveFailures: number
  update: (patch: Partial<Settings>) => void
  updateApiToken: (token: string) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [apiToken, setApiToken] = useState('')
  const [ready, setReady] = useState(false)
  const [saveFailures, setSaveFailures] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      loadSettings(preferencesKV),
      loadApiToken(preferencesKV, secureKV),
    ]).then(([loaded, token]) => {
      if (cancelled) return
      setSettings(loaded)
      setApiToken(token)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      void saveSettings(preferencesKV, next).catch((err: unknown) => {
        console.warn('saveSettings failed — in-memory settings may not persist', err)
        setSaveFailures((n) => n + 1)
      })
      return next
    })
  }, [])

  const updateApiToken = useCallback((token: string) => {
    setApiToken(token)
    void saveApiToken(preferencesKV, secureKV, token).catch(() => {
      // Secure write failed (broken Keystore): the in-memory token still
      // works for this session and nothing on disk was deleted — next launch
      // falls back to whatever is recoverable or prompts for re-entry.
    })
  }, [])

  // Apply theme class to <html> so tokens flip app-wide.
  useEffect(() => {
    document.documentElement.classList.toggle('light', settings.theme === 'light')
  }, [settings.theme])

  const value = useMemo(
    () => ({ settings, apiToken, ready, saveFailures, update, updateApiToken }),
    [settings, apiToken, ready, saveFailures, update, updateApiToken],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (ctx === null) throw new Error('useSettings outside SettingsProvider')
  return ctx
}
