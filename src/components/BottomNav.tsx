import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { preferencesKV } from '@/data/kv'
import { loadReadBriefIds } from '@/features/briefs/readStore'
import { useBriefs, useToday } from '@/hooks/queries'
import { InboxIcon, NewspaperIcon } from './icons'

const TABS: readonly { to: string; label: string; icon: ReactNode }[] = [
  { to: '/', label: 'Today', icon: '◉' },
  { to: '/inbox', label: 'Inbox', icon: <InboxIcon size={20} /> },
  { to: '/capture', label: 'Capture', icon: '+' },
  { to: '/briefs', label: 'Briefs', icon: <NewspaperIcon size={20} /> },
  { to: '/more', label: 'More', icon: '⋯' },
]

export function BottomNav() {
  const today = useToday()
  const briefs = useBriefs()
  const location = useLocation()

  const inboxCount = today.data?.inboxCount ?? 0

  // Client-only read state; re-read on navigation so leaving a brief clears
  // the dot without a reboot.
  const [readBriefIds, setReadBriefIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    void loadReadBriefIds(preferencesKV).then(setReadBriefIds)
  }, [location.pathname])
  const hasUnreadBriefs =
    briefs.data?.items.some((item) => !readBriefIds.has(item.id)) ?? false

  return (
    <nav
      className="bg-bg/92 fixed inset-x-0 bottom-0 z-30 border-t border-line backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 text-micro font-medium transition-colors ${
                isActive ? 'text-accent' : 'text-faint'
              }`
            }
          >
            {tab.to === '/capture' ? (
              <span className="bg-accent text-accent-ink -mt-4 flex h-11 w-11 items-center justify-center rounded-full text-xl font-semibold shadow-lg">
                {tab.icon}
              </span>
            ) : (
              <>
                <span className="relative flex h-5 items-center text-title-lg leading-none">
                  {tab.icon}
                  {tab.to === '/inbox' && inboxCount > 0 && (
                    <span className="bg-accent text-accent-ink tnum absolute -top-1.5 left-3.5 rounded-full px-1 py-px text-micro font-bold">
                      {inboxCount}
                    </span>
                  )}
                  {tab.to === '/briefs' && hasUnreadBriefs && (
                    <span
                      aria-label="unread"
                      className="bg-accent absolute -top-0.5 left-4 h-2 w-2 rounded-full"
                    />
                  )}
                </span>
                <span>{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
