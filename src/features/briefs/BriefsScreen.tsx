import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import { FilterChip } from '@/components/FilterChip'
import {
  Badge,
  EmptyState,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  StaleBanner,
} from '@/components/primitives'
import { CheckCheckIcon, NewspaperIcon, PinIcon } from '@/components/icons'
import { useSnackbar } from '@/components/SnackbarProvider'
import { preferencesKV } from '@/data/kv'
import { useBriefs } from '@/hooks/queries'
import { formatDay } from '@/lib/dates'
import type { BriefKind, BriefListItem } from '@/schemas'
import { UnreadDot } from './UnreadDot'
import { loadPinnedBriefIds, toggleBriefPin } from './pinStore'
import { loadReadBriefIds, markAllBriefsRead } from './readStore'

type KindFilter = 'all' | BriefKind

const FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'morning', label: 'Morning' },
  { key: 'adhoc', label: 'Adhoc' },
]

const emptyFilterCopy: Record<BriefKind, { title: string; hint: string }> = {
  morning: {
    title: 'No morning briefs',
    hint: 'The agent writes one each morning there is something worth telling you.',
  },
  adhoc: {
    title: 'No adhoc briefs',
    hint: 'Adhoc briefs appear when something urgent comes up between mornings.',
  },
}

function BriefRow({
  brief,
  read,
  pinned,
  onOpen,
  onTogglePin,
}: {
  brief: BriefListItem
  read: boolean
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
}) {
  return (
    <div className="border-line bg-surface flex min-h-11 w-full items-center rounded-(--radius-card) border">
      <button
        onClick={onOpen}
        className="active:bg-raised flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-l-(--radius-card) py-4 pl-4 text-left transition-colors"
      >
        {!read && <UnreadDot />}
        <span className="truncate text-sm leading-snug font-medium">{brief.title}</span>
      </button>
      <Badge tone={brief.kind === 'morning' ? 'accent' : 'neutral'}>{brief.kind}</Badge>
      <button
        aria-label={pinned ? 'Unpin' : 'Pin'}
        aria-pressed={pinned}
        onClick={onTogglePin}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:opacity-70"
      >
        <PinIcon
          size={16}
          className={pinned ? 'text-accent' : 'text-faint'}
          fill={pinned ? 'currentColor' : 'none'}
          aria-hidden
        />
      </button>
    </div>
  )
}

export function BriefsScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useBriefs()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set())
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState<KindFilter>('all')

  useEffect(() => {
    void loadReadBriefIds(preferencesKV).then(setReadIds)
    void loadPinnedBriefIds(preferencesKV).then(setPinnedIds)
  }, [])

  const items = data?.items ?? []
  const visible = filter === 'all' ? items : items.filter((b) => b.kind === filter)
  const pinnedItems = visible.filter((b) => pinnedIds.has(b.id))
  const unpinned = visible.filter((b) => !pinnedIds.has(b.id))

  // Items arrive newest first; group consecutive runs by date.
  const groups: { date: string; items: BriefListItem[] }[] = []
  for (const item of unpinned) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.date === item.date) last.items.push(item)
    else groups.push({ date: item.date, items: [item] })
  }

  const open = (brief: BriefListItem) =>
    void navigate(`/briefs/${encodeURIComponent(brief.id)}`)
  const togglePin = (brief: BriefListItem) =>
    void toggleBriefPin(preferencesKV, brief.id).then(setPinnedIds)
  const markAllRead = () => {
    void markAllBriefsRead(preferencesKV, items.map((b) => b.id)).then((read) => {
      setReadIds(read)
      snackbar.show({ message: 'All briefs marked read' })
    })
  }

  return (
    <Screen
      title="Briefs"
      back
      actions={
        items.length > 0 ? (
          <button
            aria-label="Mark all read"
            onClick={markAllRead}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-raised"
          >
            <CheckCheckIcon size={18} />
          </button>
        ) : undefined
      }
    >
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={5} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState kind={errorKind} onRetry={() => void refetch()} />
        )}
        {data !== undefined && (
          <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {FILTERS.map((f) => (
              <FilterChip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </FilterChip>
            ))}
          </div>
        )}
        {data !== undefined && items.length === 0 && (
          <EmptyState
            icon={<NewspaperIcon size={30} />}
            title="No briefs yet"
            hint="The agent writes a morning brief once there is something worth telling you."
          />
        )}
        {data !== undefined && items.length > 0 && visible.length === 0 && filter !== 'all' && (
          <EmptyState
            icon={<NewspaperIcon size={30} />}
            title={emptyFilterCopy[filter].title}
            hint={emptyFilterCopy[filter].hint}
          />
        )}
        {pinnedItems.length > 0 && (
          <div>
            <SectionHeader>Pinned</SectionHeader>
            <div className="space-y-2">
              {pinnedItems.map((brief) => (
                <BriefRow
                  key={brief.id}
                  brief={brief}
                  read={readIds.has(brief.id)}
                  pinned
                  onOpen={() => open(brief)}
                  onTogglePin={() => togglePin(brief)}
                />
              ))}
            </div>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.date}>
            <SectionHeader>{formatDay(group.date)}</SectionHeader>
            <div className="space-y-2">
              {group.items.map((brief) => (
                <BriefRow
                  key={brief.id}
                  brief={brief}
                  read={readIds.has(brief.id)}
                  pinned={false}
                  onOpen={() => open(brief)}
                  onTogglePin={() => togglePin(brief)}
                />
              ))}
            </div>
          </div>
        ))}
      </PullToRefresh>
    </Screen>
  )
}
