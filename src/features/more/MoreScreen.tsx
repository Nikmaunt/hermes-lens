import { useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import {
  FileTextIcon,
  FlameIcon,
  FolderIcon,
  GraphIcon,
  InboxIcon,
  LanguagesIcon,
  RadioIcon,
  ScaleIcon,
  SettingsIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons'
import { useData } from '@/data/DataSourceProvider'
import { useInbox } from '@/hooks/queries'

const ITEMS: readonly {
  to: string
  icon: IconComponent
  label: string
  hint: string
}[] = [
  { to: '/inbox', icon: InboxIcon, label: 'Inbox', hint: 'swipe triage' },
  { to: '/projects', icon: FolderIcon, label: 'Projects', hint: 'status & next actions' },
  { to: '/people', icon: UsersIcon, label: 'People', hint: 'context & agreements' },
  { to: '/documents', icon: FileTextIcon, label: 'Documents & Money', hint: 'renewals, spend' },
  { to: '/decisions', icon: ScaleIcon, label: 'Decision Log', hint: 'why I chose what' },
  { to: '/habits', icon: FlameIcon, label: 'Habits', hint: 'streaks & heatmap' },
  { to: '/polish', icon: LanguagesIcon, label: 'Polish words', hint: 'daily flashcards' },
  { to: '/memory/map', icon: GraphIcon, label: 'Memory Map', hint: 'what the agent knows' },
  { to: '/status', icon: RadioIcon, label: 'Agent Status', hint: 'gateway, cron, backup' },
  { to: '/settings', icon: SettingsIcon, label: 'Settings', hint: 'source, lock, theme' },
]

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
            <div className="text-muted">
              <item.icon size={22} />
            </div>
            <div className="mt-2 text-sm font-semibold">{item.label}</div>
            <div className="mt-0.5 text-caption text-faint">{item.hint}</div>
            {item.to === '/inbox' && inboxCount > 0 && (
              <span className="bg-accent text-accent-ink tnum absolute top-3 right-3 rounded-full px-1.5 py-0.5 text-micro font-bold">
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
