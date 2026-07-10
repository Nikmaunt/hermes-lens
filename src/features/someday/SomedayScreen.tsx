import { useState } from 'react'
import { ActionChip } from '@/components/ActionChip'
import { actionChipClass } from '@/components/actionChipStyles'
import { DatePickerButton } from '@/components/DatePickerButton'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  StaleBanner,
} from '@/components/primitives'
import { ArchiveIcon, CalendarIcon, CheckIcon } from '@/components/icons'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useData } from '@/data/DataSourceProvider'
import { useSomeday } from '@/hooks/queries'
import { useSomedayAction, useSomedayUndo, useQueuedMutationsOf } from '@/hooks/mutations'
import { formatDate } from '@/lib/dates'
import { snoozeTomorrow } from '@/lib/snooze'
import { undoAction } from '@/lib/undo'
import { somedayGoneMessage } from '@/lib/goneOutcome'
import type { SomedayActionRequest, SomedayItem, SomedayPendingAction } from '@/schemas'

/** How long the post-action snackbar offers Undo. */
const UNDO_WINDOW_MS = 5000

/** Activate/close only — undo travels through its own queue kind. */
type SomedayWriteRequest = Exclude<SomedayActionRequest, { action: 'undo' }>

export function SomedayScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useSomeday()
  const snackbar = useSnackbar()
  const somedayAction = useSomedayAction()
  const somedayUndo = useSomedayUndo()
  const { ds, queue } = useData()
  const queuedActions = useQueuedMutationsOf('someday-action')
  // Just-clicked actions, bridging the gap until the refetched payload
  // carries the server-side pendingAction (or the offline queue lists it).
  const [localActions, setLocalActions] = useState<ReadonlyMap<string, SomedayWriteRequest>>(
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

  const clearLocalAction = (id: string) =>
    setLocalActions((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })

  const undo = (item: SomedayItem) => {
    // The optimistic syncing state drops immediately; the queue withdrawal
    // or the undo request settles in the background.
    clearLocalAction(item.id)
    setUndoneIds((prev) => new Set(prev).add(item.id))
    void undoAction(
      queue,
      (m) => m.kind === 'someday-action' && m.source === ds.kind && m.itemId === item.id,
      () => somedayUndo.mutateAsync({ itemId: item.id }),
    ).then(({ gone }) => {
      if (gone) {
        // The agent already handled the original action — drop the card
        // quietly and let the refetch settle the rest.
        setGoneIds((prev) => new Set(prev).add(item.id))
        snackbar.show({ message: somedayGoneMessage })
      }
    })
  }

  const act = (item: SomedayItem, req: SomedayWriteRequest) => {
    setUndoneIds((prev) => {
      if (!prev.has(item.id)) return prev
      const next = new Set(prev)
      next.delete(item.id)
      return next
    })
    setLocalActions((prev) => new Map(prev).set(item.id, req))
    setInflightIds((prev) => new Set(prev).add(item.id))
    somedayAction.mutate(
      { itemId: item.id, req },
      {
        onSettled: () => {
          setInflightIds((prev) => {
            const next = new Set(prev)
            next.delete(item.id)
            return next
          })
        },
        onSuccess: ({ gone }) => {
          if (gone) {
            setGoneIds((prev) => new Set(prev).add(item.id))
            return
          }
          // Sent or queued — either way the action is still cancellable.
          snackbar.show({
            message:
              req.action === 'activate' ? `Activates on ${formatDate(req.date)}` : 'Closed',
            actionLabel: 'Undo',
            durationMs: UNDO_WINDOW_MS,
            onAction: () => undo(item),
          })
        },
      },
    )
  }

  /** Server pendingAction, queued offline mutation and a just-made tap all
   * draw the same syncing treatment. */
  const pendingActionFor = (
    item: SomedayItem,
  ): { action: SomedayPendingAction['action']; date?: string | undefined } | null =>
    (undoneIds.has(item.id) ? null : item.pendingAction) ??
    queuedActions.find((m) => m.itemId === item.id)?.req ??
    localActions.get(item.id) ??
    null

  return (
    <Screen title="Someday" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState kind={errorKind} onRetry={() => void refetch()} />
        )}
        {data !== undefined && data.items.length === 0 && (
          <EmptyState
            icon={<ArchiveIcon size={30} />}
            title="Nothing parked for someday"
            hint="Send a follow-up here with “Someday” and it waits without a due date."
          />
        )}
        <div className="space-y-2">
          {data?.items
            .filter((item) => !goneIds.has(item.id))
            .map((item) => {
              const pending = pendingActionFor(item)
              return (
                <Card key={item.id} className={pending !== null ? 'opacity-60' : ''}>
                  <div className="min-w-0">
                    <div
                      className={`text-sm leading-snug font-medium ${
                        pending !== null ? 'text-muted line-through' : ''
                      }`}
                    >
                      {item.title}
                    </div>
                    {item.source !== undefined && (
                      <div className="mt-1 truncate text-caption text-faint">{item.source}</div>
                    )}
                  </div>
                  {pending !== null ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone="accent">syncing</Badge>
                      <span className="flex-1 text-caption text-faint">
                        {pending.action === 'activate'
                          ? pending.date !== undefined
                            ? `activates on ${formatDate(pending.date)}`
                            : 'activates'
                          : 'closed'}
                      </span>
                      {!inflightIds.has(item.id) && (
                        <ActionChip ariaLabel={`Undo: ${item.title}`} onClick={() => undo(item)}>
                          Undo
                        </ActionChip>
                      )}
                    </div>
                  ) : (
                    /* Same chip language as the Today follow-up row: one line,
                       primary action accent, the rest neutral. */
                    <div className="mt-2.5 flex items-center gap-2">
                      <DatePickerButton
                        min={snoozeTomorrow()}
                        inputLabel={`Activate date: ${item.title}`}
                        ariaLabel={`Activate: ${item.title}`}
                        onPick={(date) => act(item, { action: 'activate', date })}
                        className={actionChipClass('accent')}
                      >
                        <CalendarIcon size={14} aria-hidden />
                        Activate
                      </DatePickerButton>
                      <ActionChip
                        ariaLabel={`Close: ${item.title}`}
                        onClick={() => act(item, { action: 'close' })}
                      >
                        <CheckIcon size={14} aria-hidden />
                        Close
                      </ActionChip>
                    </div>
                  )}
                </Card>
              )
            })}
        </div>
      </PullToRefresh>
    </Screen>
  )
}
