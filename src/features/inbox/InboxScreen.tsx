import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import {
  Badge,
  EmptyState,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  StaleBanner,
} from '@/components/primitives'
import { useSnackbar } from '@/components/SnackbarProvider'
import {
  ArchiveIcon,
  DiamondIcon,
  SparklesIcon,
  SquareCheckIcon,
  StickyNoteIcon,
  TrashIcon,
  type IconComponent,
} from '@/components/icons'
import { NoteText } from '@/components/NoteText'
import { preferencesKV } from '@/data/kv'
import { useData } from '@/data/DataSourceProvider'
import { useInbox } from '@/hooks/queries'
import { useTriage, useUntriage } from '@/hooks/mutations'
import { relativeTime, toIsoDateTime } from '@/lib/dates'
import { plainNoteText } from '@/lib/noteText'
import { tapMedium } from '@/lib/haptics'
import { undoAction } from '@/lib/undo'
import { triageGoneOutcome } from '@/lib/goneOutcome'
import {
  appendProcessingLog,
  loadProcessingLog,
  removeFromProcessingLog,
  type ProcessingEntry,
} from './processingLog'
import type { InboxItem, TriageDestination } from '@/schemas'
import { useSettings } from '@/settings/SettingsProvider'
import type { SwipeMapping } from '@/settings/settings'

const SWIPE_THRESHOLD_PX = 90
const UNDO_WINDOW_MS = 5000

const DESTINATION_META: Record<TriageDestination, { label: string; icon: IconComponent }> = {
  note: { label: 'Note', icon: StickyNoteIcon },
  task: { label: 'Task', icon: SquareCheckIcon },
  memory: { label: 'Memory', icon: DiamondIcon },
  archive: { label: 'Archive', icon: ArchiveIcon },
  trash: { label: 'Trash', icon: TrashIcon },
}

type Direction = keyof SwipeMapping

export function InboxScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useInbox()
  const { settings } = useSettings()
  const triage = useTriage()
  const untriage = useUntriage()
  const { ds, queue } = useData()
  const snackbar = useSnackbar()
  const navigate = useNavigate()

  // Local deck: server items minus locally-decided ones (optimistic).
  const [decided, setDecided] = useState<Set<string>>(new Set())
  const pending = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>(),
  )

  // Recently triaged notes (48 h sliding window in kv) — shown in the
  // dimmed Processing section instead of vanishing on swipe.
  const [processingLog, setProcessingLog] = useState<ProcessingEntry[]>([])
  const refreshProcessing = useCallback(() => {
    void loadProcessingLog(preferencesKV).then(setProcessingLog)
  }, [])
  useEffect(() => {
    refreshProcessing()
  }, [refreshProcessing])

  useEffect(() => {
    const map = pending.current
    return () => {
      // Leaving the screen commits pending triages immediately — a swipe the
      // user didn't undo must not be lost just because they navigated away.
      for (const [, entry] of map) {
        clearTimeout(entry.timer)
        entry.commit()
      }
      map.clear()
    }
  }, [])

  // Timeline capture events deep-link here; if the item is still untriaged
  // it floats to the top of the deck, otherwise the tap lands on the root.
  const location = useLocation()
  const highlightId = (location.state as { highlightId?: string } | null)?.highlightId

  const deck = (data?.items ?? [])
    .filter((item) => !decided.has(item.id))
    .sort((a, b) => Number(b.id === highlightId) - Number(a.id === highlightId))
  const top = deck[0]

  const decide = (item: InboxItem, direction: Direction) => {
    tapMedium() // gesture commit
    const destination = settings.swipeMapping[direction]
    setDecided((prev) => new Set(prev).add(item.id))
    // The note lands in Processing right away; an undo pulls it back out.
    void appendProcessingLog(preferencesKV, {
      itemId: item.id,
      text: item.text,
      destination,
      at: toIsoDateTime(new Date()),
    }).then(refreshProcessing)

    // The triage call is delayed by the undo window; undo just cancels it.
    const commit = () => {
      pending.current.delete(item.id)
      triage.mutate(
        { itemId: item.id, destination },
        {
          onSuccess: ({ queued }) => {
            if (queued) snackbar.show({ message: 'Offline — triage queued for sync' })
          },
        },
      )
    }
    const timer = setTimeout(commit, UNDO_WINDOW_MS)
    pending.current.set(item.id, { timer, commit })

    snackbar.show({
      message: `→ ${DESTINATION_META[destination].label}`,
      actionLabel: 'Undo',
      durationMs: UNDO_WINDOW_MS,
      onAction: () => {
        const entry = pending.current.get(item.id)
        if (entry !== undefined) {
          clearTimeout(entry.timer)
          pending.current.delete(item.id)
        }
        setDecided((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
        void removeFromProcessingLog(preferencesKV, item.id).then(refreshProcessing)
      },
    })
  }

  /**
   * Undo a triage from the Processing section, whatever stage it reached:
   * a still-delayed commit is cancelled locally, a queued mutation is
   * withdrawn without any network call, a sent one is untriaged server-side.
   */
  const undoProcessing = (entry: ProcessingEntry) => {
    const delayed = pending.current.get(entry.itemId)
    if (delayed !== undefined) {
      clearTimeout(delayed.timer)
      pending.current.delete(entry.itemId)
      setDecided((prev) => {
        const next = new Set(prev)
        next.delete(entry.itemId)
        return next
      })
      void removeFromProcessingLog(preferencesKV, entry.itemId).then(refreshProcessing)
      return
    }

    let queuedOffline = false
    void undoAction(queue, (m) => m.kind === 'triage' && m.source === ds.kind && m.itemId === entry.itemId, async () => {
      const res = await untriage.mutateAsync({ itemId: entry.itemId })
      queuedOffline = res.queued
      return res
    }).then(({ gone }) => {
      if (queuedOffline) {
        // The undo itself is waiting for the network; the entry stays in
        // Processing until the queue drains and the refetch settles it.
        snackbar.show({ message: 'Offline — undo queued for sync' })
        return
      }
      if (gone) {
        // Say what the agent did with the note and, when it landed on another
        // screen, offer to go see it — recovered from the triage's destination.
        const outcome = triageGoneOutcome(entry.destination)
        const link = outcome.link
        snackbar.show({
          message: outcome.message,
          ...(link !== undefined
            ? { actionLabel: link.label, onAction: () => void navigate(link.route) }
            : {}),
        })
      }
      // ok → the note is back in the inbox (refetch); gone → it is the
      // agent's now. Either way the entry leaves Processing.
      setDecided((prev) => {
        const next = new Set(prev)
        next.delete(entry.itemId)
        return next
      })
      void removeFromProcessingLog(preferencesKV, entry.itemId).then(refreshProcessing)
    })
  }

  // Log entries whose item is hidden — either decided locally just now or
  // already absent from the server payload. Items back in the deck (e.g. a
  // dead-lettered triage) stay out of Processing.
  const deckIds = new Set(deck.map((item) => item.id))
  const processingRows = processingLog.filter((e) => !deckIds.has(e.itemId))

  return (
    <Screen title="Inbox" back>
      <StaleBanner since={staleSince} />
      {isLoading && <ListSkeleton rows={3} />}
      {!isLoading && error !== null && data === undefined && (
        <ErrorState
          kind={errorKind}
          onRetry={() => void refetch()}
        />
      )}
      {!isLoading && data !== undefined && deck.length === 0 && (
        <EmptyState
          icon={<SparklesIcon size={30} />}
          title="Inbox zero"
          hint="Every note has found its place."
        />
      )}

      {top !== undefined && (
        <>
          <div className="mb-3 flex items-center justify-between px-1 text-caption text-faint">
            <span className="tnum">{deck.length} to triage</span>
            <span>swipe to sort</span>
          </div>
          <div className="relative h-80">
            {/* Static preview of the next two cards behind the active one. */}
            {deck.slice(1, 3).map((item, i) => (
              <div
                key={item.id}
                className="border-line bg-surface absolute inset-0 rounded-(--radius-card) border"
                style={{
                  transform: `scale(${1 - (i + 1) * 0.04}) translateY(${(i + 1) * 10}px)`,
                  zIndex: 2 - i,
                  opacity: 1 - (i + 1) * 0.25,
                }}
              />
            ))}
            <SwipeCard key={top.id} item={top} onDecide={(dir) => decide(top, dir)} mapping={settings.swipeMapping} />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 text-center text-caption text-faint">
            {(['left', 'up', 'down', 'right'] as const).map((dir) => {
              const DestIcon = DESTINATION_META[settings.swipeMapping[dir]].icon
              return (
                <div key={dir} className="rounded-lg border border-line py-2">
                  <div className="flex items-center justify-center gap-1" aria-hidden>
                    {dir === 'left' ? '←' : dir === 'right' ? '→' : dir === 'up' ? '↑' : '↓'}
                    <DestIcon size={13} />
                  </div>
                  <div className="mt-0.5">{DESTINATION_META[settings.swipeMapping[dir]].label}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {processingRows.length > 0 && (
        <>
          <SectionHeader>Processing</SectionHeader>
          <ul className="space-y-2">
            {processingRows.map((entry) => {
              const meta = DESTINATION_META[entry.destination]
              return (
                <li
                  key={entry.itemId}
                  className="border-line bg-surface flex min-h-11 items-center gap-3 rounded-(--radius-card) border p-3"
                >
                  {/* Content dims; the Undo affordance keeps full contrast. */}
                  <div className="flex min-w-0 flex-1 items-center gap-3 opacity-60">
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">
                      {plainNoteText(entry.text).split('\n')[0]}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-caption text-faint">
                      <meta.icon size={13} aria-hidden />
                      {`→ ${meta.label}`}
                    </span>
                  </div>
                  <button
                    onClick={() => undoProcessing(entry)}
                    className="text-accent flex h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold active:opacity-70"
                  >
                    Undo
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Screen>
  )
}

function SwipeCard({
  item,
  mapping,
  onDecide,
}: {
  item: InboxItem
  mapping: SwipeMapping
  onDecide: (direction: Direction) => void
}) {
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState<Direction | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)

  const direction: Direction | null =
    Math.abs(drag.x) < 30 && Math.abs(drag.y) < 30
      ? null
      : Math.abs(drag.x) >= Math.abs(drag.y)
        ? drag.x > 0
          ? 'right'
          : 'left'
        : drag.y > 0
          ? 'down'
          : 'up'

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    origin.current = { x: e.clientX, y: e.clientY }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current === null || leaving !== null) return
    setDrag({ x: e.clientX - origin.current.x, y: e.clientY - origin.current.y })
  }

  const onPointerUp = () => {
    if (origin.current === null || leaving !== null) return
    origin.current = null
    setDragging(false)
    const distance = Math.max(Math.abs(drag.x), Math.abs(drag.y))
    if (distance >= SWIPE_THRESHOLD_PX && direction !== null) {
      setLeaving(direction)
      // Let the fling animation play, then commit.
      setTimeout(() => onDecide(direction), 160)
    } else {
      setDrag({ x: 0, y: 0 })
    }
  }

  const flingTransform =
    leaving === null
      ? `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.05}deg)`
      : leaving === 'left'
        ? 'translate(-120vw, 0) rotate(-20deg)'
        : leaving === 'right'
          ? 'translate(120vw, 0) rotate(20deg)'
          : leaving === 'up'
            ? 'translate(0, -120vh)'
            : 'translate(0, 120vh)'

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="border-line bg-raised absolute inset-0 z-10 flex touch-none flex-col rounded-(--radius-card) border p-5 shadow-xl select-none"
      style={{
        transform: flingTransform,
        transition: dragging ? 'none' : 'transform 0.2s ease-out',
      }}
    >
      <div className="flex items-center justify-between">
        <Badge tone="neutral">{item.source}</Badge>
        <span className="text-caption text-faint">{relativeTime(item.capturedAt)}</span>
      </div>
      <NoteText text={item.text} className="mt-4 flex-1 overflow-hidden text-title leading-relaxed" />
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span key={tag} className="text-accent text-xs">
              #{tag}
            </span>
          ))}
        </div>
      )}
      {direction !== null && leaving === null && (
        <div className="bg-accent-dim text-accent absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold whitespace-nowrap">
          {(() => {
            const DestIcon = DESTINATION_META[mapping[direction]].icon
            return <DestIcon size={15} />
          })()}
          {DESTINATION_META[mapping[direction]].label}
        </div>
      )}
    </div>
  )
}
