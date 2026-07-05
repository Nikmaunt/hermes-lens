import { useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import {
  DiamondIcon,
  FileTextIcon,
  FlameIcon,
  FolderIcon,
  GraphIcon,
  LanguagesIcon,
  RadioIcon,
  ScaleIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons'
import { useData } from '@/data/DataSourceProvider'

const ITEMS: readonly {
  to: string
  icon: IconComponent
  label: string
  hint: string
}[] = [
  // Timeline and Memory ceded their tab slots to Inbox and Briefs.
  { to: '/timeline', icon: ScrollTextIcon, label: 'Timeline', hint: 'everything the agent did' },
  { to: '/memory', icon: DiamondIcon, label: 'Memory', hint: 'facts the agent keeps' },
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
  const { pendingCount } = useData()

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
