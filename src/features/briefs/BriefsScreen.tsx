import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { CollapsibleSection } from '@/components/CollapsibleSection'
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
import { formatDay, formatDayMonth, toIsoDate } from '@/lib/dates'
import type { BriefKind, BriefListItem } from '@/schemas'
import { UnreadDot } from './UnreadDot'
import { loadEarlierExpanded, saveEarlierExpanded } from './earlierStore'
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
    <div className="border-line bg-surface flex min-h-11 w-full items-center gap-2 rounded-(--radius-card) border">
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

/**
 * History row: past briefs are archive, not news — no kind badge (the feed
 * is almost all morning briefs), the date rides inline in the row instead
 * of a per-day separator. Pin and unread state stay tappable.
 */
function CompactBriefRow({
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
    <div className="flex min-h-11 w-full items-center gap-2 border-b border-line last:border-0">
      <button
        onClick={onOpen}
        className="active:bg-raised flex min-w-0 flex-1 items-center gap-2 self-stretch py-2.5 pl-1 text-left transition-colors"
      >
        {!read && <UnreadDot />}
        <span className="tnum shrink-0 text-caption text-faint">
          {formatDayMonth(brief.date)} ·
        </span>
        <span className="truncate text-sm leading-snug text-muted">{brief.title}</span>
      </button>
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
  const [earlierExpanded, setEarlierExpanded] = useState(false)

  useEffect(() => {
    void loadReadBriefIds(preferencesKV).then(setReadIds)
    void loadPinnedBriefIds(preferencesKV).then(setPinnedIds)
    void loadEarlierExpanded(preferencesKV).then(setEarlierExpanded)
  }, [])
  const toggleEarlier = () => {
    const next = !earlierExpanded
    setEarlierExpanded(next)
    void saveEarlierExpanded(preferencesKV, next)
  }

  const items = data?.items ?? []
  // The Adhoc chip earns its place only once an adhoc brief exists; a
  // filter left selected when its briefs vanish falls back to All.
  const filters = FILTERS.filter(
    (f) => f.key !== 'adhoc' || items.some((b) => b.kind === 'adhoc'),
  )
  const activeFilter = filters.some((f) => f.key === filter) ? filter : 'all'
  const visible = activeFilter === 'all' ? items : items.filter((b) => b.kind === activeFilter)
  const pinnedItems = visible.filter((b) => pinnedIds.has(b.id))
  const unpinned = visible.filter((b) => !pinnedIds.has(b.id))

  // Two shelves, both newest first: today's briefs are news and keep the
  // card; everything older is one Earlier group of compact rows.
  const todayIso = toIsoDate(new Date())
  const todayItems = unpinned.filter((b) => b.date === todayIso)
  const earlierItems = unpinned.filter((b) => b.date !== todayIso)

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
            {filters.map((f) => (
              <FilterChip
                key={f.key}
                active={activeFilter === f.key}
                onClick={() => setFilter(f.key)}
              >
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
        {data !== undefined && items.length > 0 && visible.length === 0 && activeFilter !== 'all' && (
          <EmptyState
            icon={<NewspaperIcon size={30} />}
            title={emptyFilterCopy[activeFilter].title}
            hint={emptyFilterCopy[activeFilter].hint}
          />
        )}
        {/* Sections stay flat siblings (no per-group wrapper): a wrapped
            SectionHeader becomes its group's :first-child and loses the
            mt-6 gap that keeps it off the previous group's last card. */}
        {pinnedItems.length > 0 && (
          <>
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
          </>
        )}
        {todayItems.length > 0 && (
          <>
            <SectionHeader>{formatDay(todayIso)}</SectionHeader>
            <div className="space-y-2">
              {todayItems.map((brief) => (
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
          </>
        )}
        {earlierItems.length > 0 && (
          <CollapsibleSection
            title="Earlier"
            count={earlierItems.length}
            expanded={earlierExpanded}
            onToggle={toggleEarlier}
          >
            <div>
              {earlierItems.map((brief) => (
                <CompactBriefRow
                  key={brief.id}
                  brief={brief}
                  read={readIds.has(brief.id)}
                  pinned={false}
                  onOpen={() => open(brief)}
                  onTogglePin={() => togglePin(brief)}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}
      </PullToRefresh>
    </Screen>
  )
}
