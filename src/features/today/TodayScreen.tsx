import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  StaleBanner,
  TodaySkeleton,
} from '@/components/primitives'
import { DueBadge, type DueTone } from '@/components/DueBadge'
import { ChevronRightIcon, SunIcon } from '@/components/icons'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useToday } from '@/hooks/queries'
import { useSettings } from '@/settings/SettingsProvider'
import { formatDay, formatTime } from '@/lib/dates'
import { eventTarget } from '@/lib/eventRoute'
import type { FollowUp } from '@/schemas'
import { updateTodayWidget } from '../widget/widget'

const urgencyTone: Record<FollowUp['urgency'], DueTone> = {
  overdue: 'overdue',
  today: 'warn',
  soon: 'neutral',
}

export function TodayScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useToday()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const maskWidget = settings.appLock && settings.widgetHideDetails

  // Keep the home-screen widget in sync with what the user sees.
  useEffect(() => {
    if (data !== undefined) void updateTodayWidget(data, maskWidget)
  }, [data, maskWidget])

  return (
    <Screen title={data !== undefined ? formatDay(data.date) : 'Today'}>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <TodaySkeleton />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined &&
          data.inboxCount === 0 &&
          data.followUps.length === 0 &&
          data.deadlines.length === 0 &&
          data.agentActivity.length === 0 && (
            <EmptyState
              icon={<SunIcon size={30} />}
              title="All clear"
              hint="No follow-ups, no deadlines, an empty inbox and a quiet agent. Enjoy it."
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
                      <div className="mt-1 truncate text-caption text-faint">{fu.source}</div>
                    </div>
                    {fu.dueDate !== null && (
                      <DueBadge date={fu.dueDate} tone={urgencyTone[fu.urgency]} />
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
                      <div className="mt-0.5 text-caption text-faint capitalize">{d.kind}</div>
                    </div>
                    <DueBadge
                      date={d.date}
                      tone={d.daysLeft <= 3 ? 'overdue' : d.daysLeft <= 10 ? 'warn' : 'neutral'}
                    />
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
              {data.agentActivity.map((a) => {
                // Today's digest rows carry no relatedId (contract), so taps
                // land on the category's list root; agent rows explain
                // themselves with a toast instead of a dead end.
                const target = eventTarget(a.category)
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      if (target === null) {
                        snackbar.show({ message: `${a.summary} — runs privately, no detail view` })
                        return
                      }
                      void navigate(target.route)
                    }}
                    className="active:bg-raised flex min-h-11 w-full items-start gap-3 border-b border-line py-2.5 text-left transition-colors last:border-0"
                  >
                    <span className="tnum pt-px text-caption text-faint">{formatTime(a.at)}</span>
                    <span className="flex-1 text-sm leading-snug">{a.summary}</span>
                    {target !== null && (
                      <ChevronRightIcon size={13} className="mt-0.5 text-faint" aria-hidden />
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </PullToRefresh>
    </Screen>
  )
}
