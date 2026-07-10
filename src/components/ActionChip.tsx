import type { ReactNode } from 'react'
import { actionChipClass, type ActionChipTone } from './actionChipStyles'

/** Compact action chip for card action rows — see actionChipStyles.ts for
 * the sizing/touch-target contract. */
export function ActionChip({
  tone = 'neutral',
  onClick,
  ariaLabel,
  ariaExpanded,
  ariaControls,
  children,
}: {
  tone?: ActionChipTone
  onClick: () => void
  ariaLabel?: string
  ariaExpanded?: boolean
  /** Id of the element this chip toggles — set it only while that element exists. */
  ariaControls?: string | undefined
  children: ReactNode
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      onClick={onClick}
      className={actionChipClass(tone)}
    >
      {children}
    </button>
  )
}
