import { useEffect, useState } from 'react'
import { PIN_LENGTH } from '@/lib/pin'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const

/** Six-dot PIN entry pad. Calls onComplete when all digits are in. */
export function PinPad({
  title,
  error,
  onComplete,
}: {
  title: string
  error?: string
  onComplete: (pin: string) => void
}) {
  const [digits, setDigits] = useState('')

  useEffect(() => {
    if (digits.length === PIN_LENGTH) {
      const pin = digits
      // Let the last dot render before handing off.
      const t = setTimeout(() => {
        setDigits('')
        onComplete(pin)
      }, 120)
      return () => clearTimeout(t)
    }
    return undefined
  }, [digits, onComplete])

  const press = (key: string) => {
    if (key === '⌫') setDigits((d) => d.slice(0, -1))
    else if (key !== '' && digits.length < PIN_LENGTH) setDigits((d) => d + key)
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-sm font-medium text-muted">{title}</div>
      <div className="flex gap-3">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full transition-colors ${
              i < digits.length ? 'bg-accent' : 'bg-raised'
            }`}
          />
        ))}
      </div>
      {error !== undefined && <div className="text-danger -mt-3 text-xs">{error}</div>}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key, i) =>
          key === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              onClick={() => press(key)}
              className="tnum h-14 w-18 rounded-xl text-xl font-medium text-ink transition-colors active:bg-raised"
            >
              {key}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
