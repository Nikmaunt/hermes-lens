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
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings'

interface SettingsContextValue {
  settings: Settings
  /** True until settings are loaded from Preferences (first paint gate). */
  ready: boolean
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadSettings(preferencesKV).then((loaded) => {
      if (cancelled) return
      setSettings(loaded)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      void saveSettings(preferencesKV, next)
      return next
    })
  }, [])

  // Apply theme class to <html> so tokens flip app-wide.
  useEffect(() => {
    document.documentElement.classList.toggle('light', settings.theme === 'light')
  }, [settings.theme])

  const value = useMemo(() => ({ settings, ready, update }), [settings, ready, update])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (ctx === null) throw new Error('useSettings outside SettingsProvider')
  return ctx
}
