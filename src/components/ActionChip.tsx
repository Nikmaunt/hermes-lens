import type { ReactNode } from 'react'
import { actionChipClass, type ActionChipTone } from './actionChipStyles'

/** Compact action chip for card action rows — see actionChipStyles.ts for
 * the sizing/touch-target contract. */
export function ActionChip({
  tone = 'neutral',
  onClick,
  ariaLabel,
  ariaExpanded,
  children,
}: {
  tone?: ActionChipTone
  onClick: () => void
  ariaLabel?: string
  ariaExpanded?: boolean
  children: ReactNode
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      className={actionChipClass(tone)}
    >
      {children}
    </button>
  )
}
