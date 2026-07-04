import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  Card,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  StaleBanner,
} from '@/components/primitives'
import { useToday } from '@/hooks/queries'
import { dueLabel, formatDay, formatTime } from '@/lib/dates'
import type { FollowUp } from '@/schemas'
import { updateTodayWidget } from '../widget/widget'

const urgencyTone: Record<FollowUp['urgency'], 'danger' | 'warn' | 'neutral'> = {
  overdue: 'danger',
  today: 'warn',
  soon: 'neutral',
}

export function TodayScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useToday()
  const navigate = useNavigate()

  // Keep the home-screen widget in sync with what the user sees.
  useEffect(() => {
    if (data !== undefined) void updateTodayWidget(data)
  }, [data])

  return (
    <Screen title={data !== undefined ? formatDay(data.date) : 'Today'}>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={5} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined && (
          <>
            {data.inboxCount > 0 && (
              <Card onClick={() => void navigate('/inbox')} className="mb-1">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Inbox</div>
                    <div className="text-xs text-faint">unprocessed notes waiting for triage</div>
                  </div>
                  <span className="bg-accent text-accent-ink tnum rounded-full px-2.5 py-1 text-sm font-bold">
                    {data.inboxCount}
                  </span>
                </div>
              </Card>
            )}

            <SectionHeader>Open follow-ups</SectionHeader>
            {data.followUps.length === 0 && (
              <div className="px-1 py-2 text-sm text-faint">Nothing waiting on you. Rare.</div>
            )}
            <div className="space-y-2">
              {data.followUps.map((fu) => (
                <Card key={fu.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm leading-snug font-medium">{fu.title}</div>
                      <div className="mt-1 truncate text-[11px] text-faint">{fu.source}</div>
                    </div>
                    {fu.dueDate !== null && (
                      <Badge tone={urgencyTone[fu.urgency]}>{dueLabel(fu.dueDate)}</Badge>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            <SectionHeader
              right={
                <button
                  onClick={() => void navigate('/documents')}
                  className="text-xs font-medium text-faint active:opacity-70"
                >
                  all →
                </button>
              }
            >
              Deadlines
            </SectionHeader>
            {data.deadlines.length === 0 && (
              <div className="px-1 py-2 text-sm text-faint">Nothing due in the next 30 days.</div>
            )}
            <div className="space-y-2">
              {data.deadlines.map((d) => (
                <Card key={d.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{d.title}</div>
                      <div className="mt-0.5 text-[11px] text-faint capitalize">{d.kind}</div>
                    </div>
                    <Badge tone={d.daysLeft <= 3 ? 'danger' : d.daysLeft <= 10 ? 'warn' : 'neutral'}>
                      {dueLabel(d.date)}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>

            <SectionHeader
              right={
                <button
                  onClick={() => void navigate('/timeline')}
                  className="text-xs font-medium text-faint active:opacity-70"
                >
                  timeline →
                </button>
              }
            >
              Agent, last 24 h
            </SectionHeader>
            {data.agentActivity.length === 0 && (
              <div className="px-1 py-2 text-sm text-faint">The agent has been quiet.</div>
            )}
            <div>
              {data.agentActivity.map((a) => (
                <div key={a.id} className="flex gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="tnum pt-px text-[11px] text-faint">{formatTime(a.at)}</span>
                  <span className="flex-1 text-sm leading-snug">{a.summary}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </PullToRefresh>
    </Screen>
  )
}
