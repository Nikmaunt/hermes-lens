import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import { FilterChip } from '@/components/FilterChip'
import { EmptyState, ErrorState, FeedSkeleton, StaleBanner } from '@/components/primitives'
import { useData } from '@/data/DataSourceProvider'
import { useTimeline } from '@/hooks/queries'
import { useHighlightScroll } from '@/hooks/useHighlightScroll'
import { formatDay, formatTime, toIsoDate } from '@/lib/dates'
import { timelineEventTarget } from '@/lib/eventRoute'
import { plainNoteText } from '@/lib/noteText'
import { EventCategory, type TimelineEvent } from '@/schemas'
import { CATEGORY_META } from '@/lib/categoryMeta'
import { ChevronDownIcon, ChevronRightIcon, WavesIcon } from '@/components/icons'

function groupByDay(events: TimelineEvent[]): [string, TimelineEvent[]][] {
  const groups = new Map<string, TimelineEvent[]>()
  for (const event of events) {
    const day = toIsoDate(new Date(event.at))
    const list = groups.get(day)
    if (list === undefined) groups.set(day, [event])
    else list.push(event)
  }
  return [...groups.entries()]
}

export function TimelineScreen() {
  const [category, setCategory] = useState<EventCategory | undefined>(undefined)
  const { data, staleSince, errorKind, isLoading, error, refetch } = useTimeline(category)
  const { ds } = useData()
  const navigate = useNavigate()
  // System and agent events open in place (no detail screen behind them);
  // one row at a time, like the inbox cards.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [older, setOlder] = useState<TimelineEvent[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Manually loaded older pages belong to the current filter; reset on change.
  const filterKey = category ?? 'all'
  const [loadedFor, setLoadedFor] = useState(filterKey)
  if (loadedFor !== filterKey) {
    setLoadedFor(filterKey)
    setOlder([])
    setOlderCursor(null)
  }

  const events = useMemo(() => [...(data?.events ?? []), ...older], [data, older])

  useHighlightScroll(events.length > 0)
  const cursor = olderCursor ?? data?.nextBefore ?? null

  const loadMore = async () => {
    if (cursor === null || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await ds.getTimeline({ before: cursor, ...(category ? { category } : {}) })
      setOlder((prev) => [...prev, ...page.events])
      setOlderCursor(page.nextBefore)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Screen title="Timeline">
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <FilterChip active={category === undefined} onClick={() => setCategory(undefined)}>
          All
        </FilterChip>
        {EventCategory.options.map((c) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_META[c].label}
          </FilterChip>
        ))}
      </div>

      <PullToRefresh
        onRefresh={async () => {
          setOlder([])
          setOlderCursor(null)
          await refetch()
        }}
      >
        <StaleBanner since={staleSince} />
        {isLoading && <FeedSkeleton rows={6} />}
        {!isLoading && error !== null && events.length === 0 && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {!isLoading && error === null && events.length === 0 && (
          <EmptyState
            icon={<WavesIcon size={30} />}
            title="No events here"
            hint="Try a different category filter."
          />
        )}
        {groupByDay(events).map(([day, dayEvents]) => (
          <section key={day}>
            <h2 className="bg-bg/85 sticky top-[58px] z-10 -mx-4 mb-1 px-5 pt-3 pb-1 text-label font-semibold tracking-wide text-faint backdrop-blur-md">
              {formatDay(day)}
            </h2>
            <div>
              {dayEvents.map((event) => {
                const CategoryIcon = CATEGORY_META[event.category].icon
                const target = timelineEventTarget(event.category, event.relatedId, event.title)
                const expanded = expandedId === event.id
                const open = () => {
                  if (target === null) {
                    // No detail screen behind this event — unfold what the
                    // response carries right here instead.
                    setExpandedId(expanded ? null : event.id)
                    return
                  }
                  void navigate(
                    target.route,
                    target.highlightId !== undefined
                      ? { state: { highlightId: target.highlightId } }
                      : undefined,
                  )
                }
                return (
                <button
                  key={event.id}
                  data-item-id={event.id}
                  onClick={open}
                  {...(target === null ? { 'aria-expanded': expanded } : {})}
                  className="active:bg-raised flex min-h-11 w-full gap-3 border-b border-line py-3 text-left transition-colors last:border-0"
                >
                  <span className="pt-0.5 text-faint" aria-hidden>
                    <CategoryIcon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm leading-snug font-medium">{event.title}</div>
                    {event.detail !== null && (
                      <div className="mt-0.5 text-body-sm leading-snug whitespace-pre-line text-muted">
                        {plainNoteText(event.detail)}
                      </div>
                    )}
                    {expanded && (
                      <div className="mt-2 space-y-1 border-t border-line pt-2 text-caption text-faint">
                        <div className="flex gap-3">
                          <span className="w-10 shrink-0">Type</span>
                          <span className="text-muted">{CATEGORY_META[event.category].label}</span>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-10 shrink-0">Time</span>
                          <span className="tnum text-muted">
                            {formatDay(toIsoDate(new Date(event.at)))} · {formatTime(event.at)}
                          </span>
                        </div>
                        {event.relatedId !== null && (
                          <div className="flex gap-3">
                            <span className="w-10 shrink-0">Ref</span>
                            <span className="tnum break-all text-muted">{event.relatedId}</span>
                          </div>
                        )}
                        {event.category === 'agent' && (
                          <p className="pt-1">Runs privately — the transcript stays on the VPS.</p>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="flex items-start gap-0.5 pt-0.5">
                    <span className="tnum text-caption text-faint">{formatTime(event.at)}</span>
                    {target !== null ? (
                      <ChevronRightIcon size={13} className="mt-px text-faint" aria-hidden />
                    ) : (
                      <ChevronDownIcon
                        size={13}
                        className={`mt-px text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    )}
                  </span>
                </button>
                )
              })}
            </div>
          </section>
        ))}
        {cursor !== null && (
          <button
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="mt-4 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-muted active:bg-raised disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load older'}
          </button>
        )}
      </PullToRefresh>
    </Screen>
  )
}

