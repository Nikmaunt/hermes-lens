import { useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import { useData } from '@/data/DataSourceProvider'
import { useInbox } from '@/hooks/queries'

const ITEMS = [
  { to: '/inbox', icon: '📥', label: 'Inbox', hint: 'swipe triage' },
  { to: '/projects', icon: '🗂', label: 'Projects', hint: 'status & next actions' },
  { to: '/people', icon: '👥', label: 'People', hint: 'context & agreements' },
  { to: '/documents', icon: '📄', label: 'Documents & Money', hint: 'renewals, spend' },
  { to: '/decisions', icon: '⚖️', label: 'Decision Log', hint: 'why I chose what' },
  { to: '/habits', icon: '🔥', label: 'Habits', hint: 'streaks & heatmap' },
  { to: '/polish', icon: '🇵🇱', label: 'Polish words', hint: 'daily flashcards' },
  { to: '/memory/map', icon: '🕸', label: 'Memory Map', hint: 'what the agent knows' },
  { to: '/status', icon: '🛰', label: 'Agent Status', hint: 'gateway, cron, backup' },
  { to: '/settings', icon: '⚙️', label: 'Settings', hint: 'source, lock, theme' },
] as const

export function MoreScreen() {
  const navigate = useNavigate()
  const inbox = useInbox()
  const { pendingCount } = useData()
  const inboxCount = inbox.data?.items.length ?? 0

  return (
    <Screen title="More">
      <div className="grid grid-cols-2 gap-3">
        {ITEMS.map((item) => (
          <button
            key={item.to}
            onClick={() => void navigate(item.to)}
            className="relative rounded-(--radius-card) border border-line bg-surface p-4 text-left transition-colors active:bg-raised"
          >
            <div className="text-xl">{item.icon}</div>
            <div className="mt-2 text-sm font-semibold">{item.label}</div>
            <div className="mt-0.5 text-[11px] text-faint">{item.hint}</div>
            {item.to === '/inbox' && inboxCount > 0 && (
              <span className="bg-accent text-accent-ink tnum absolute top-3 right-3 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                {inboxCount}
              </span>
            )}
          </button>
        ))}
      </div>
      {pendingCount > 0 && (
        <div className="mt-4 text-center text-xs text-faint">
          {pendingCount} action{pendingCount === 1 ? '' : 's'} waiting to sync
        </div>
      )}
    </Screen>
  )
}
