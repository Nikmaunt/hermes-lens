import { useNavigate } from 'react-router'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import { Badge, SectionHeader } from '@/components/primitives'
import {
  ArchiveIcon,
  DiamondIcon,
  FileTextIcon,
  FlameIcon,
  FolderIcon,
  GraphIcon,
  RadioIcon,
  ScaleIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons'
import { useData } from '@/data/DataSourceProvider'
import { useCommands } from '@/hooks/queries'
import { relativeTime } from '@/lib/dates'
import type { CommandState, CommandStatus, CommandType } from '@/schemas'

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
  { to: '/someday', icon: ArchiveIcon, label: 'Someday', hint: 'parked, no due date' },
  { to: '/memory/map', icon: GraphIcon, label: 'Memory Map', hint: 'what the agent knows' },
  { to: '/status', icon: RadioIcon, label: 'Agent Status', hint: 'gateway, cron, backup' },
  { to: '/settings', icon: SettingsIcon, label: 'Settings', hint: 'source, lock, theme' },
]

/** How many recent commands the hub lists; the rest live server-side only. */
const COMMANDS_SHOWN = 5

const COMMAND_TYPE_LABELS: Record<CommandType, string> = {
  'adhoc-digest': 'Digest',
  'create-note': 'Person note',
}

const COMMAND_STATE_TONES: Record<CommandState, 'neutral' | 'accent' | 'ok' | 'danger'> = {
  pending: 'neutral',
  running: 'accent',
  done: 'ok',
  error: 'danger',
}

function CommandRow({ command }: { command: CommandStatus }) {
  const navigate = useNavigate()
  // Only a finished digest has somewhere to go (its brief). A note result
  // has no detail screen — its id shows as plain reference text instead.
  const briefId = command.result?.kind === 'brief' ? command.result.id : null

  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {COMMAND_TYPE_LABELS[command.type]}
        </span>
        <span className="tnum shrink-0 text-caption text-faint">
          {relativeTime(command.requestedAt)}
        </span>
        <Badge tone={COMMAND_STATE_TONES[command.state]}>{command.state}</Badge>
      </div>
      {command.summary !== undefined && (
        <div className="mt-1 text-caption text-muted">{command.summary}</div>
      )}
      {command.result?.kind === 'note' && (
        <div className="mt-0.5 text-caption text-faint">{command.result.id}</div>
      )}
    </>
  )

  if (briefId !== null) {
    return (
      <button
        onClick={() => void navigate(`/briefs/${briefId}`)}
        className="active:bg-raised w-full px-1 py-2.5 text-left transition-colors"
      >
        {body}
      </button>
    )
  }
  return <div className="px-1 py-2.5">{body}</div>
}

function CommandsSection() {
  const { data, isLoading } = useCommands()
  // A source without the endpoint yet (older sidecar) just hides the
  // section — the hub must not nag about a feature it cannot show.
  if (isLoading || data === undefined) return null

  return (
    <>
      <SectionHeader>Commands</SectionHeader>
      {data.items.length === 0 ? (
        <p className="px-1 text-caption text-faint">
          No commands yet — queue one from Capture → Command.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface px-3">
          {data.items.slice(0, COMMANDS_SHOWN).map((command) => (
            <CommandRow key={command.commandId} command={command} />
          ))}
        </div>
      )}
    </>
  )
}

export function MoreScreen() {
  const navigate = useNavigate()
  const { pendingCount, deadLetterCount } = useData()
  const commands = useCommands()

  return (
    <Screen title="More">
      <PullToRefresh onRefresh={commands.refetch}>
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
        <CommandsSection />
        {pendingCount > 0 && (
          <div className="mt-4 text-center text-xs text-faint">
            {pendingCount} action{pendingCount === 1 ? '' : 's'} waiting to sync
          </div>
        )}
        {deadLetterCount > 0 && (
          <div className={`${pendingCount > 0 ? 'mt-1' : 'mt-4'} text-center text-xs text-danger`}>
            {deadLetterCount} action{deadLetterCount === 1 ? '' : 's'} failed to sync — review in
            Settings
          </div>
        )}
      </PullToRefresh>
    </Screen>
  )
}
