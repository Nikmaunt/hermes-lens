import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ActionChip } from '@/components/ActionChip'
import { actionChipClass } from '@/components/actionChipStyles'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { DatePickerButton } from '@/components/DatePickerButton'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  StaleBanner,
  TodaySkeleton,
} from '@/components/primitives'
import { DueBadge, type DueTone } from '@/components/DueBadge'
import {
  ArchiveIcon,
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  NewspaperIcon,
  SunIcon,
} from '@/components/icons'
import { UnreadDot } from '@/features/briefs/UnreadDot'
import { loadReadBriefIds } from '@/features/briefs/readStore'
import { preferencesKV } from '@/data/kv'
import { useData } from '@/data/DataSourceProvider'
import { useSnackbar } from '@/components/SnackbarProvider'
import { SomedayList } from '@/features/someday/SomedayList'
import { useSomeday, useToday } from '@/hooks/queries'
import { useFollowupAction, useFollowupUndo, useQueuedMutationsOf } from '@/hooks/mutations'
import {
  loadSectionChoices,
  saveSectionChoices,
  type SectionChoices,
  type TodaySectionId,
} from './sectionStore'
import { useSettings } from '@/settings/SettingsProvider'
import { formatDate, formatDay, formatTime } from '@/lib/dates'
import { snoozeNextMonday, snoozeTomorrow } from '@/lib/snooze'
import { undoAction } from '@/lib/undo'
import { followupGoneMessage } from '@/lib/goneOutcome'
import { eventTarget } from '@/lib/eventRoute'
import type {
  AgentStatus,
  FollowUp,
  FollowUpPendingAction,
  FollowupActionRequest,
} from '@/schemas'
import { updateTodayWidget } from '../widget/widget'

const urgencyTone: Record<FollowUp['urgency'], DueTone> = {
  overdue: 'overdue',
  today: 'warn',
  soon: 'neutral',
}

/** How long the post-action snackbar offers Undo. */
const UNDO_WINDOW_MS = 5000

export function TodayScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useToday()
  const somedayItems = useSomeday().data?.items
  const { settings } = useSettings()
  const navigate = useNavigate()
  const snackbar = useSnackbar()
  const maskWidget = settings.appLock && settings.widgetHideDetails

  const followupAction = useFollowupAction()
  const followupUndo = useFollowupUndo()
  const { ds, queue, cache } = useData()
  const queuedActions = useQueuedMutationsOf('followup-action')
  // Just-clicked actions, bridging the gap until the refetched payload
  // carries the server-side pendingAction (or the offline queue lists it).
  const [localActions, setLocalActions] = useState<ReadonlyMap<string, FollowupActionRequest>>(
    new Map(),
  )
  // Items the server reported gone: already resolved by the agent — drop
  // them quietly, never an error.
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(new Set())
  // Items whose pending action was just undone: suppress the stale
  // pendingAction from the cached payload until the refetch lands.
  const [undoneIds, setUndoneIds] = useState<ReadonlySet<string>>(new Set())
  // Items whose original request is still in flight. Undo is withheld until
  // it settles — an undo racing the action it cancels would answer "gone"
  // and then lose to the late-arriving original.
  const [inflightIds, setInflightIds] = useState<ReadonlySet<string>>(new Set())
  const [snoozeMenuFor, setSnoozeMenuFor] = useState<string | null>(null)

  // Collapse choices for the sections, kv-persisted per user tap. The ref
  // mirrors the state so long-lived closures (the snackbar's View action)
  // never write a stale map back; the async load merges UNDER any tap that
  // beat it.
  const [sectionChoices, setSectionChoices] = useState<SectionChoices>({})
  const sectionChoicesRef = useRef<SectionChoices>({})
  useEffect(() => {
    void loadSectionChoices(preferencesKV).then((loaded) => {
      sectionChoicesRef.current = { ...loaded, ...sectionChoicesRef.current }
      setSectionChoices(sectionChoicesRef.current)
    })
  }, [])
  const setSectionExpanded = (id: TodaySectionId, expanded: boolean) => {
    const next = { ...sectionChoicesRef.current, [id]: expanded }
    sectionChoicesRef.current = next
    setSectionChoices(next)
    void saveSectionChoices(preferencesKV, next)
  }
  const isExpanded = (id: TodaySectionId, dflt: boolean) => sectionChoices[id] ?? dflt
  const toggleSection = (id: TodaySectionId, dflt: boolean) =>
    setSectionExpanded(id, !isExpanded(id, dflt))

  const somedaySectionRef = useRef<HTMLDivElement>(null)
  /** The snackbar View action: open the Someday section and bring it on screen. */
  const revealSomeday = () => {
    setSectionExpanded('someday', true)
    // Not implemented in jsdom — hence the optional call.
    somedaySectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const clearLocalAction = (id: string) =>
    setLocalActions((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })

  const undo = (fu: FollowUp) => {
    // The optimistic syncing state drops immediately; the queue withdrawal
    // or the undo request settles in the background.
    clearLocalAction(fu.id)
    setUndoneIds((prev) => new Set(prev).add(fu.id))
    void undoAction(
      queue,
      (m) => m.kind === 'followup-action' && m.source === ds.kind && m.itemId === fu.id,
      () => followupUndo.mutateAsync({ itemId: fu.id }),
    ).then(
      ({ gone }) => {
        if (gone) {
          // The agent already handled the original action — drop the card
          // quietly and let the refetch settle the rest.
          setGoneIds((prev) => new Set(prev).add(fu.id))
          snackbar.show({ message: followupGoneMessage })
        }
      },
    )
  }

  const act = (fu: FollowUp, req: FollowupActionRequest) => {
    setSnoozeMenuFor(null)
    setUndoneIds((prev) => {
      if (!prev.has(fu.id)) return prev
      const next = new Set(prev)
      next.delete(fu.id)
      return next
    })
    setLocalActions((prev) => new Map(prev).set(fu.id, req))
    setInflightIds((prev) => new Set(prev).add(fu.id))
    followupAction.mutate(
      { itemId: fu.id, req },
      {
        onSettled: () => {
          setInflightIds((prev) => {
            const next = new Set(prev)
            next.delete(fu.id)
            return next
          })
        },
        onSuccess: ({ gone }) => {
          if (gone) {
            setGoneIds((prev) => new Set(prev).add(fu.id))
            return
          }
          // Sent or queued — either way the action is still cancellable.
          snackbar.show({
            message:
              req.action === 'done'
                ? 'Marked done'
                : req.action === 'someday'
                  ? 'Moved to someday'
                  : req.until !== undefined
                    ? `Snoozed to ${formatDate(req.until)}`
                    : 'Snoozed',
            actionLabel: 'Undo',
            durationMs: UNDO_WINDOW_MS,
            onAction: () => undo(fu),
            // "Where did it go?" — View opens the Someday section in place.
            ...(req.action === 'someday'
              ? { secondaryActionLabel: 'View', onSecondaryAction: revealSomeday }
              : {}),
          })
        },
      },
    )
  }

  /** Server pendingAction, queued offline mutation and a just-made tap all
   * draw the same syncing treatment. */
  const pendingActionFor = (
    fu: FollowUp,
  ): { action: FollowUpPendingAction['action']; until?: string | undefined } | null =>
    (undoneIds.has(fu.id) ? null : fu.pendingAction) ??
    queuedActions.find((m) => m.itemId === fu.id)?.req ??
    localActions.get(fu.id) ??
    null

  // Keep the home-screen widget in sync with what the user sees: same
  // payload, same pending/gone exclusions, plus the health line from the
  // last cached /api/status (the widget itself never hits the network).
  useEffect(() => {
    if (data === undefined) return
    let alive = true
    void cache.read<AgentStatus>(`${ds.kind}:status`).then((cached) => {
      if (!alive) return
      const pendingIds = new Set<string>([
        ...queuedActions.map((m) => m.itemId),
        ...localActions.keys(),
        ...goneIds,
      ])
      void updateTodayWidget(data, {
        status: cached?.payload ?? null,
        pendingIds,
        masked: maskWidget,
      })
    })
    return () => {
      alive = false
    }
  }, [data, maskWidget, cache, ds.kind, queuedActions, localActions, goneIds])

  // Client-only read state for the brief card's unread dot.
  const [readBriefIds, setReadBriefIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    void loadReadBriefIds(preferencesKV).then(setReadBriefIds)
  }, [data?.brief?.id])

  // Gone cards drop from the list AND the header count — they must agree.
  const visibleFollowUps = data?.followUps.filter((fu) => !goneIds.has(fu.id)) ?? []

  return (
    <Screen title={data !== undefined ? formatDay(data.date) : 'Today'}>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {/* Always available — asks the agent directly, needs no loaded data. */}
        <Card onClick={() => void navigate('/chat')} className="mb-1">
          <div className="flex items-center gap-3">
            <span className="text-accent" aria-hidden>
              <BotIcon size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Ask Hermes</div>
              <div className="text-xs text-faint">Put a question to your agent</div>
            </div>
            <ChevronRightIcon size={13} className="shrink-0 text-faint" aria-hidden />
          </div>
        </Card>
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
            {data.brief !== undefined &&
              (readBriefIds.has(data.brief.id) ? (
                // Once read, the brief stops owning the top of Today: it folds
                // into a thin one-line strip until a new, unread brief lands.
                <button
                  onClick={() =>
                    void navigate(`/briefs/${encodeURIComponent(data.brief?.id ?? '')}`)
                  }
                  className="mb-1 flex min-h-11 w-full items-center gap-2 px-1 text-left active:opacity-70"
                >
                  <span className="text-faint" aria-hidden>
                    <NewspaperIcon size={15} />
                  </span>
                  <span className="flex-1 truncate text-xs text-faint">Morning brief · read</span>
                  <ChevronRightIcon size={12} className="shrink-0 text-faint" aria-hidden />
                </button>
              ) : (
                <Card
                  onClick={() =>
                    void navigate(`/briefs/${encodeURIComponent(data.brief?.id ?? '')}`)
                  }
                  className="mb-1"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-faint" aria-hidden>
                      <NewspaperIcon size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <UnreadDot />
                        <span className="truncate text-sm font-semibold">{data.brief.title}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-faint">today's brief</div>
                    </div>
                    <ChevronRightIcon size={13} className="shrink-0 text-faint" aria-hidden />
                  </div>
                </Card>
              ))}
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

            <CollapsibleSection
              title="Open follow-ups"
              count={visibleFollowUps.length}
              expanded={isExpanded('followups', true)}
              onToggle={() => toggleSection('followups', true)}
            >
            {visibleFollowUps.length === 0 && (
              <div className="px-1 py-2 text-sm text-faint">Nothing waiting on you. Rare.</div>
            )}
            <div className="space-y-2">
              {visibleFollowUps
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
                          <span className="flex-1 text-caption text-faint">
                            {pending.action === 'done'
                              ? 'marked done'
                              : pending.action === 'someday'
                                ? 'moved to someday'
                                : pending.until !== undefined
                                  ? `snoozed to ${formatDate(pending.until)}`
                                  : 'snoozed'}
                          </span>
                          {!inflightIds.has(fu.id) && (
                            <ActionChip ariaLabel={`Undo: ${fu.title}`} onClick={() => undo(fu)}>
                              Undo
                            </ActionChip>
                          )}
                        </div>
                      ) : (
                        <>
                          {/* A single non-wrapping chip row — the card must not
                              grow into a wall of buttons on a 360dp screen. */}
                          <div className="mt-2.5 flex items-center gap-2">
                            <ActionChip
                              tone="accent"
                              ariaLabel={`Done: ${fu.title}`}
                              onClick={() => act(fu, { action: 'done' })}
                            >
                              <CheckIcon size={14} aria-hidden />
                              Done
                            </ActionChip>
                            <ActionChip
                              ariaLabel={`Snooze: ${fu.title}`}
                              ariaExpanded={snoozeMenuFor === fu.id}
                              // Only while the submenu is mounted — a dangling
                              // aria-controls id is an a11y-audit error.
                              ariaControls={
                                snoozeMenuFor === fu.id ? `snooze-menu-${fu.id}` : undefined
                              }
                              onClick={() =>
                                setSnoozeMenuFor(snoozeMenuFor === fu.id ? null : fu.id)
                              }
                            >
                              <ClockIcon size={14} aria-hidden />
                              Snooze
                            </ActionChip>
                            <ActionChip
                              ariaLabel={`Someday: ${fu.title}`}
                              onClick={() => act(fu, { action: 'someday' })}
                            >
                              <ArchiveIcon size={14} aria-hidden />
                              Someday
                            </ActionChip>
                          </div>
                          {snoozeMenuFor === fu.id && (
                            /* One line, like the action row above — the three
                               chips fit a 360dp card without wrapping. */
                            <div
                              id={`snooze-menu-${fu.id}`}
                              className="animate-expand mt-2 flex items-center gap-2"
                            >
                              <ActionChip
                                tone="outline"
                                onClick={() => act(fu, { action: 'snooze', until: snoozeTomorrow() })}
                              >
                                Tomorrow
                              </ActionChip>
                              <ActionChip
                                tone="outline"
                                onClick={() =>
                                  act(fu, { action: 'snooze', until: snoozeNextMonday() })
                                }
                              >
                                Next Monday
                              </ActionChip>
                              <DatePickerButton
                                min={snoozeTomorrow()}
                                inputLabel="Snooze until date"
                                onPick={(date) => act(fu, { action: 'snooze', until: date })}
                                className={actionChipClass('outline')}
                              >
                                Pick a date…
                              </DatePickerButton>
                            </div>
                          )}
                        </>
                      )}
                    </Card>
                  )
                })}
            </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Deadlines"
              count={data.deadlines.length}
              expanded={isExpanded('deadlines', data.deadlines.length > 0)}
              onToggle={() => toggleSection('deadlines', data.deadlines.length > 0)}
              right={
                <button
                  onClick={() => void navigate('/documents')}
                  className="text-xs font-medium text-faint active:opacity-70"
                >
                  all →
                </button>
              }
            >
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
            </CollapsibleSection>

            {/* Parked items, between the dated sections and the agent noise —
                same list and mutations as the Someday screen. */}
            <div ref={somedaySectionRef}>
              <CollapsibleSection
                title="Someday"
                count={somedayItems?.length}
                expanded={isExpanded('someday', false)}
                onToggle={() => toggleSection('someday', false)}
              >
                {somedayItems !== undefined &&
                  (somedayItems.length === 0 ? (
                    <div className="px-1 py-2 text-sm text-faint">
                      Nothing parked for someday.
                    </div>
                  ) : (
                    <SomedayList items={somedayItems} />
                  ))}
              </CollapsibleSection>
            </div>

            <CollapsibleSection
              title="Agent, last 24 h"
              expanded={isExpanded('agent', false)}
              onToggle={() => toggleSection('agent', false)}
              right={
                <button
                  onClick={() => void navigate('/timeline')}
                  className="text-xs font-medium text-faint active:opacity-70"
                >
                  timeline →
                </button>
              }
            >
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
            </CollapsibleSection>
          </>
        )}
      </PullToRefresh>
    </Screen>
  )
}
