import { useRef, type ReactNode } from 'react'

/**
 * A WebView renders a valueless <input type="date"> as an ugly empty frame,
 * so the visible control is a styled button; the real input stays hidden and
 * only supplies the native calendar. Extracted from the Today snooze picker
 * so the Someday activate flow shares the exact same mechanics.
 */
export function DatePickerButton({
  min,
  inputLabel,
  onPick,
  className,
  ariaLabel,
  children,
}: {
  /** Earliest pickable date (ISO). Enforced even against a lying picker. */
  min: string
  /** Accessible label of the hidden date input (the picker target). */
  inputLabel: string
  onPick: (date: string) => void
  className: string
  ariaLabel?: string
  children: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        aria-label={ariaLabel}
        onClick={() => {
          const el = inputRef.current
          if (el === null) return
          // showPicker() opens the native calendar; engines without it (or
          // contexts that refuse it) fall back to clicking the input.
          if (typeof el.showPicker === 'function') {
            try {
              el.showPicker()
            } catch {
              el.click()
            }
          } else {
            el.click()
          }
        }}
        className={className}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="date"
        aria-label={inputLabel}
        min={min}
        tabIndex={-1}
        onChange={(e) => {
          // The native picker honors min, but nothing else is trusted to:
          // past dates are dropped, not applied.
          if (e.target.value !== '' && e.target.value >= min) onPick(e.target.value)
        }}
        className="sr-only"
      />
    </>
  )
}
