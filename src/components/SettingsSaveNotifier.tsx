import { useEffect, useRef } from 'react'
import { useSettings } from '@/settings/SettingsProvider'
import { useSnackbar } from './SnackbarProvider'

/**
 * Snackbar for failed settings persists. SettingsProvider sits above
 * SnackbarProvider, so it can only count failures — this component, mounted
 * inside SnackbarProvider, turns each new failure into a visible warning.
 */
export function SettingsSaveNotifier() {
  const { saveFailures } = useSettings()
  const { show } = useSnackbar()
  const known = useRef(saveFailures)

  useEffect(() => {
    if (saveFailures > known.current) show({ message: 'Settings may not have saved' })
    known.current = saveFailures
  }, [saveFailures, show])

  return null
}
