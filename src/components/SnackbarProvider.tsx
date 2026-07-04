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

interface SnackbarOptions {
  message: string
  /** Optional action button, e.g. Undo. */
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

interface SnackbarContextValue {
  show: (options: SnackbarOptions) => void
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null)

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<SnackbarOptions | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setCurrent(null)
  }, [])

  const show = useCallback(
    (options: SnackbarOptions) => {
      if (timer.current !== null) clearTimeout(timer.current)
      setCurrent(options)
      timer.current = setTimeout(() => setCurrent(null), options.durationMs ?? 4000)
    },
    [],
  )

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const value = useMemo(() => ({ show }), [show])

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      {current !== null && (
        <div
          className="fixed inset-x-4 z-50 mx-auto max-w-md"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
        >
          <div className="animate-fade-up flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-xl">
            <span className="flex-1 text-sm">{current.message}</span>
            {current.actionLabel !== undefined && (
              <button
                onClick={() => {
                  current.onAction?.()
                  dismiss()
                }}
                className="text-accent text-sm font-semibold active:opacity-70"
              >
                {current.actionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </SnackbarContext.Provider>
  )
}

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext)
  if (ctx === null) throw new Error('useSnackbar outside SnackbarProvider')
  return ctx
}
