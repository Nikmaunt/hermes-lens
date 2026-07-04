import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Screen } from '@/components/Screen'
import {
  Badge,
  EmptyState,
  ErrorState,
  ListSkeleton,
  StaleBanner,
} from '@/components/primitives'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useInbox } from '@/hooks/queries'
import { useTriage } from '@/hooks/mutations'
import { relativeTime } from '@/lib/dates'
import { tapMedium } from '@/lib/haptics'
import type { InboxItem, TriageDestination } from '@/schemas'
import { useSettings } from '@/settings/SettingsProvider'
import type { SwipeMapping } from '@/settings/settings'

const SWIPE_THRESHOLD_PX = 90
const UNDO_WINDOW_MS = 5000

const DESTINATION_META: Record<TriageDestination, { label: string; icon: string }> = {
  note: { label: 'Note', icon: '🗒' },
  task: { label: 'Task', icon: '☑' },
  memory: { label: 'Memory', icon: '◈' },
  archive: { label: 'Archive', icon: '🗄' },
  trash: { label: 'Trash', icon: '🗑' },
}

type Direction = keyof SwipeMapping

export function InboxScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useInbox()
  const { settings } = useSettings()
  const triage = useTriage()
  const snackbar = useSnackbar()

  // Local deck: server items minus locally-decided ones (optimistic).
  const [decided, setDecided] = useState<Set<string>>(new Set())
  const pending = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>(),
  )

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

  const deck = (data?.items ?? []).filter((item) => !decided.has(item.id))
  const top = deck[0]

  const decide = (item: InboxItem, direction: Direction) => {
    tapMedium() // gesture commit
    const destination = settings.swipeMapping[direction]
    setDecided((prev) => new Set(prev).add(item.id))

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
      },
    })
  }

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
        <EmptyState icon="🌤" title="Inbox zero" hint="Every note has found its place." />
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
            {(['left', 'up', 'down', 'right'] as const).map((dir) => (
              <div key={dir} className="rounded-lg border border-line py-2">
                <div aria-hidden>
                  {dir === 'left' ? '←' : dir === 'right' ? '→' : dir === 'up' ? '↑' : '↓'}{' '}
                  {DESTINATION_META[settings.swipeMapping[dir]].icon}
                </div>
                <div className="mt-0.5">{DESTINATION_META[settings.swipeMapping[dir]].label}</div>
              </div>
            ))}
          </div>
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
      <p className="mt-4 flex-1 text-title leading-relaxed">{item.text}</p>
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
        <div className="bg-accent-dim text-accent absolute top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-sm font-bold">
          {DESTINATION_META[mapping[direction]].icon} {DESTINATION_META[mapping[direction]].label}
        </div>
      )}
    </div>
  )
}
