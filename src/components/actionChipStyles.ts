/*
 * Class recipe for the compact action chips (Today follow-ups, Someday).
 * Same hit-area pattern as FilterChip: a ~32px visible pill plus an invisible
 * before: extension that guarantees the 44px touch target without inflating
 * the card — action rows stay a single line. Kept out of ActionChip.tsx so
 * className-driven controls (DatePickerButton) share it without breaking
 * fast refresh.
 */

export type ActionChipTone = 'accent' | 'neutral' | 'outline'

const toneClass: Record<ActionChipTone, string> = {
  accent: 'bg-accent text-accent-ink',
  neutral: 'bg-raised text-muted',
  outline: 'border border-line bg-surface text-muted active:bg-raised',
}

export function actionChipClass(tone: ActionChipTone): string {
  return `relative flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors active:opacity-70 min-w-11 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] ${toneClass[tone]}`
}
