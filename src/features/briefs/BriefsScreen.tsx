import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  EmptyState,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  StaleBanner,
} from '@/components/primitives'
import { NewspaperIcon } from '@/components/icons'
import { preferencesKV } from '@/data/kv'
import { useBriefs } from '@/hooks/queries'
import { formatDay } from '@/lib/dates'
import type { BriefListItem } from '@/schemas'
import { UnreadDot } from './UnreadDot'
import { loadReadBriefIds } from './readStore'

export function BriefsScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useBriefs()
  const navigate = useNavigate()
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    void loadReadBriefIds(preferencesKV).then(setReadIds)
  }, [])

  // Items arrive newest first; group consecutive runs by date.
  const groups: { date: string; items: BriefListItem[] }[] = []
  for (const item of data?.items ?? []) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.date === item.date) last.items.push(item)
    else groups.push({ date: item.date, items: [item] })
  }

  return (
    <Screen title="Briefs" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={5} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState kind={errorKind} onRetry={() => void refetch()} />
        )}
        {data !== undefined && data.items.length === 0 && (
          <EmptyState
            icon={<NewspaperIcon size={30} />}
            title="No briefs yet"
            hint="The agent writes a morning brief once there is something worth telling you."
          />
        )}
        {groups.map((group) => (
          <div key={group.date}>
            <SectionHeader>{formatDay(group.date)}</SectionHeader>
            <div className="space-y-2">
              {group.items.map((brief) => (
                <button
                  key={brief.id}
                  onClick={() => void navigate(`/briefs/${encodeURIComponent(brief.id)}`)}
                  className="border-line bg-surface active:bg-raised flex min-h-11 w-full items-center gap-3 rounded-(--radius-card) border p-4 text-left transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {!readIds.has(brief.id) && <UnreadDot />}
                      <span className="truncate text-sm leading-snug font-medium">
                        {brief.title}
                      </span>
                    </div>
                  </div>
                  <Badge tone={brief.kind === 'morning' ? 'accent' : 'neutral'}>
                    {brief.kind}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        ))}
      </PullToRefresh>
    </Screen>
  )
}
