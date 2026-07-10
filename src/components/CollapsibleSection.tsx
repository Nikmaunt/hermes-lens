import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from '@/components/icons'

/**
 * SectionHeader variant whose title is a disclosure button: chevron, title,
 * optional count. The `right` slot stays a sibling of the button — nested
 * buttons are invalid HTML. The visible row keeps the compact SectionHeader
 * look; before:h-11 extends the tappable height to 44px (same contract as
 * the action chips).
 */
export function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  right,
  children,
}: {
  title: string
  /** Shown as "· N" after the title; omit for count-less headers (Agent). */
  count?: number | undefined
  expanded: boolean
  onToggle: () => void
  right?: ReactNode
  children: ReactNode
}) {
  // Sections that start expanded must not play the reveal animation on the
  // screen's first paint — it belongs to the user's tap, like the snooze menu.
  const [toggled, setToggled] = useState(false)
  return (
    <>
      <div className="mt-6 mb-2 flex items-center justify-between gap-2 px-1 first:mt-0">
        <h2 className="min-w-0 flex-1 text-body-sm font-semibold tracking-[0.08em] text-faint uppercase">
          <button
            aria-expanded={expanded}
            onClick={() => {
              setToggled(true)
              onToggle()
            }}
            className="relative flex w-full items-center gap-1.5 text-left tracking-[0.08em] uppercase active:opacity-70 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
          >
            <ChevronRightIcon
              size={12}
              className={`shrink-0 transition-transform motion-reduce:transition-none ${
                expanded ? 'rotate-90' : ''
              }`}
              aria-hidden
            />
            <span className="truncate">{title}</span>
            {count !== undefined && <span className="tnum shrink-0">· {count}</span>}
          </button>
        </h2>
        {right}
      </div>
      {expanded && <div className={toggled ? 'animate-expand' : ''}>{children}</div>}
    </>
  )
}
