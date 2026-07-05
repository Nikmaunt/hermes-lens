import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  SectionHeader,
  StaleBanner,
  TodaySkeleton,
} from '@/components/primitives'
import { DueBadge, type DueTone } from '@/components/DueBadge'
import { CheckIcon, ChevronRightIcon, ClockIcon, NewspaperIcon, SunIcon } from '@/components/icons'
import { UnreadDot } from '@/features/briefs/UnreadDot'
import { loadReadBriefIds } from '@/features/briefs/readStore'
import { preferencesKV } from '@/data/kv'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useToday } from '@/hooks/queries'
import { useFollowupAction, useQueuedMutationsOf } from '@/hooks/mutations'
import { useSettings } from '@/settings/SettingsProvider'
import { formatDate, formatDay, formatTime } from '@/lib/dates'
import { snoozeNextMonday, snoozeTomorrow } from '@/lib/snooze'
import { eventTarget } from '@/lib/eventRoute'
import type { FollowUp, FollowupActionRequest } from '@/schemas'
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

  const followupAction = useFollowupAction()
  const queuedActions = useQueuedMutationsOf('followup-action')
  // Just-clicked actions, bridging the gap until the refetched payload
  // carries the server-side pendingAction (or the offline queue lists it).
  const [localActions, setLocalActions] = useState<ReadonlyMap<string, FollowupActionRequest>>(
    new Map(),
  )
  // Items the server reported gone: already resolved by the agent — drop
  // them quietly, never an error.
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(new Set())
  const [snoozeMenuFor, setSnoozeMenuFor] = useState<string | null>(null)

  const act = (fu: FollowUp, req: FollowupActionRequest) => {
    setSnoozeMenuFor(null)
    setLocalActions((prev) => new Map(prev).set(fu.id, req))
    followupAction.mutate(
      { itemId: fu.id, req },
      {
        onSuccess: ({ queued, gone }) => {
          if (gone) setGoneIds((prev) => new Set(prev).add(fu.id))
          else if (queued) snackbar.show({ message: 'Offline — action queued for sync' })
        },
      },
    )
  }

  /** Server pendingAction, queued offline mutation and a just-made tap all
   * draw the same syncing treatment. */
  const pendingActionFor = (
    fu: FollowUp,
  ): { action: 'done' | 'snooze'; until?: string | undefined } | null =>
    fu.pendingAction ??
    queuedActions.find((m) => m.itemId === fu.id)?.req ??
    localActions.get(fu.id) ??
    null

  // Keep the home-screen widget in sync with what the user sees.
  useEffect(() => {
    if (data !== undefined) void updateTodayWidget(data, maskWidget)
  }, [data, maskWidget])

  // Client-only read state for the brief card's unread dot.
  const [readBriefIds, setReadBriefIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    void loadReadBriefIds(preferencesKV).then(setReadBriefIds)
  }, [data?.brief?.id])

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
            {data.brief !== undefined && (
              <Card
                onClick={() => void navigate(`/briefs/${encodeURIComponent(data.brief?.id ?? '')}`)}
                className="mb-1"
              >
                <div className="flex items-center gap-3">
                  <span className="text-faint" aria-hidden>
                    <NewspaperIcon size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {!readBriefIds.has(data.brief.id) && <UnreadDot />}
                      <span className="truncate text-sm font-semibold">{data.brief.title}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-faint">today's brief</div>
                  </div>
                  <ChevronRightIcon size={13} className="shrink-0 text-faint" aria-hidden />
                </div>
              </Card>
            )}
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
              {data.followUps
                .filter((fu) => !goneIds.has(fu.id))
                .map((fu) => {
                  const pending = pendingActionFor(fu)
                  return (
                    <Card key={fu.id} className={pending !== null ? 'opacity-60' : ''}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-sm leading-snug font-medium ${
                              pending !== null ? 'text-muted line-through' : ''
                            }`}
                          >
                            {fu.title}
                          </div>
                          <div className="mt-1 truncate text-caption text-faint">{fu.source}</div>
                        </div>
                        {fu.dueDate !== null && (
                          <DueBadge date={fu.dueDate} tone={urgencyTone[fu.urgency]} />
                        )}
                      </div>
                      {pending !== null ? (
                        <div className="mt-2 flex items-center gap-2">
                          <Badge tone="accent">syncing</Badge>
                          <span className="text-caption text-faint">
                            {pending.action === 'done'
                              ? 'marked done'
                              : pending.until !== undefined
                                ? `snoozed to ${formatDate(pending.until)}`
                                : 'snoozed'}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="mt-2.5 flex items-center gap-2">
                            <button
                              aria-label={`Done: ${fu.title}`}
                              onClick={() => act(fu, { action: 'done' })}
                              className="bg-ok-dim text-ok flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium active:opacity-70"
                            >
                              <CheckIcon size={16} aria-hidden />
                              Done
                            </button>
                            <button
                              aria-label={`Snooze: ${fu.title}`}
                              aria-expanded={snoozeMenuFor === fu.id}
                              onClick={() =>
                                setSnoozeMenuFor(snoozeMenuFor === fu.id ? null : fu.id)
                              }
                              className="bg-raised flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium text-muted active:opacity-70"
                            >
                              <ClockIcon size={16} aria-hidden />
                              Snooze
                            </button>
                          </div>
                          {snoozeMenuFor === fu.id && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => act(fu, { action: 'snooze', until: snoozeTomorrow() })}
                                className="border-line bg-surface flex h-11 items-center rounded-full border px-4 text-sm font-medium text-muted active:bg-raised"
                              >
                                Tomorrow
                              </button>
                              <button
                                onClick={() =>
                                  act(fu, { action: 'snooze', until: snoozeNextMonday() })
                                }
                                className="border-line bg-surface flex h-11 items-center rounded-full border px-4 text-sm font-medium text-muted active:bg-raised"
                              >
                                Next Monday
                              </button>
                              <input
                                type="date"
                                aria-label="Snooze until date"
                                min={snoozeTomorrow()}
                                onChange={(e) => {
                                  if (e.target.value !== '')
                                    act(fu, { action: 'snooze', until: e.target.value })
                                }}
                                className="border-line bg-surface h-11 rounded-full border px-3 text-sm text-muted outline-none focus:border-accent focus-visible:outline-none"
                              />
                            </div>
                          )}
                        </>
                      )}
                    </Card>
                  )
                })}
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
