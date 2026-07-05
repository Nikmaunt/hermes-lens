import { useMemo, useState } from 'react'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Card,
  EmptyState,
  ErrorState,
  HabitsSkeleton,
  StaleBanner,
} from '@/components/primitives'
import { CheckIcon, FlameIcon } from '@/components/icons'
import { useSnackbar } from '@/components/SnackbarProvider'
import { useData } from '@/data/DataSourceProvider'
import { useHabits } from '@/hooks/queries'
import { useHabitTick, useHabitUndo, useQueuedMutationsOf } from '@/hooks/mutations'
import { addDays, parseIsoDate, toIsoDate } from '@/lib/dates'
import { bestStreak, completionRate, currentStreak } from '@/lib/streaks'
import { undoAction } from '@/lib/undo'
import type { Habit } from '@/schemas'

const WEEKS_SHOWN = 12

/** How long the post-tick snackbar offers Undo. */
const UNDO_WINDOW_MS = 5000

export function HabitsScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useHabits()
  const today = toIsoDate(new Date())
  const snackbar = useSnackbar()
  const habitTick = useHabitTick()
  const habitUndo = useHabitUndo()
  const { ds, queue } = useData()
  const queuedTicks = useQueuedMutationsOf('habit-tick')
  // Just-clicked ticks, bridging the gap until the refetched payload (or the
  // offline queue) carries the date. Same optimistic treatment either way.
  const [localTicked, setLocalTicked] = useState<ReadonlySet<string>>(new Set())
  // Just-undone ticks: suppress today's date from the cached payload until
  // the refetch after the undo lands.
  const [localUnticked, setLocalUnticked] = useState<ReadonlySet<string>>(new Set())

  const without = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    if (!set.has(id)) return set
    const next = new Set(set)
    next.delete(id)
    return next
  }

  const tickedToday = (habit: Habit): boolean =>
    !localUnticked.has(habit.id) &&
    (habit.completedDates.includes(today) ||
      queuedTicks.some((m) => m.itemId === habit.id && m.req.date === today) ||
      localTicked.has(habit.id))

  const undo = (habit: Habit) => {
    // The pending date drops optimistically; the withdrawal or the undo
    // request settles in the background.
    setLocalTicked((prev) => without(prev, habit.id))
    setLocalUnticked((prev) => new Set(prev).add(habit.id))
    void undoAction(
      queue,
      (m) =>
        m.kind === 'habit-tick' &&
        m.source === ds.kind &&
        m.itemId === habit.id &&
        m.req.date === today,
      () => habitUndo.mutateAsync({ itemId: habit.id, req: { date: today } }),
    ).then(({ gone }) => {
      if (gone) {
        // The date is already written into the habit file — the tick stands.
        setLocalUnticked((prev) => without(prev, habit.id))
        snackbar.show({ message: 'Already processed by agent' })
      }
    })
  }

  const tick = (habit: Habit) => {
    setLocalUnticked((prev) => without(prev, habit.id))
    setLocalTicked((prev) => new Set(prev).add(habit.id))
    habitTick.mutate(
      { itemId: habit.id, req: { date: today } },
      {
        onSuccess: ({ gone }) => {
          // "gone" = the habit vanished server-side; the refetch drops the
          // card, nothing to tell the user.
          if (gone) return
          snackbar.show({
            message: 'Ticked',
            actionLabel: 'Undo',
            durationMs: UNDO_WINDOW_MS,
            onAction: () => undo(habit),
          })
        },
      },
    )
  }

  return (
    <Screen title="Habits" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <HabitsSkeleton rows={3} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined && data.habits.length === 0 && (
          <EmptyState
            icon={<FlameIcon size={30} />}
            title="No habits tracked yet"
            hint="The agent starts a card for every routine it sees you repeat — nothing to set up here."
          />
        )}
        <div className="space-y-3">
          {data?.habits.map((habit) => {
            const done = tickedToday(habit)
            // Optimistic view: a pending tick counts for streaks and the
            // grid; an undone one stops counting before the refetch lands.
            const completedDates = done
              ? habit.completedDates.includes(today)
                ? habit.completedDates
                : [...habit.completedDates, today]
              : habit.completedDates.filter((d) => d !== today)
            const streak = currentStreak(completedDates, today)
            const best = bestStreak(completedDates)
            const rate = completionRate(completedDates, habit.startedOn, today)
            return (
              <Card key={habit.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl" aria-hidden>
                      {habit.icon}
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{habit.name}</div>
                      <div className="tnum mt-0.5 text-caption text-faint">
                        best {best}d · {Math.round(rate * 100)}% since start
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tnum flex items-center justify-end gap-1 text-xl font-semibold tracking-tight">
                      {streak}
                      <span className="text-accent" aria-hidden>
                        <FlameIcon size={16} />
                      </span>
                    </div>
                    <div className="text-micro text-faint">day streak</div>
                  </div>
                </div>
                <HeatGrid completedDates={completedDates} today={today} />
                {done ? (
                  <button
                    disabled
                    aria-label={`Ticked today: ${habit.name}`}
                    className="bg-ok-dim text-ok mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-sm font-medium opacity-80"
                  >
                    <CheckIcon size={16} aria-hidden />
                    Done today
                  </button>
                ) : (
                  <button
                    onClick={() => tick(habit)}
                    aria-label={`Tick today: ${habit.name}`}
                    className="bg-accent-dim text-accent mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-full text-sm font-medium active:opacity-70"
                  >
                    <CheckIcon size={16} aria-hidden />
                    Tick today
                  </button>
                )}
              </Card>
            )
          })}
        </div>
      </PullToRefresh>
    </Screen>
  )
}

/**
 * GitHub-style heat calendar: one column per week, one row per weekday,
 * covering the last WEEKS_SHOWN weeks up to today.
 */
function HeatGrid({ completedDates, today }: { completedDates: string[]; today: string }) {
  const cells = useMemo(() => {
    const done = new Set(completedDates)
    const todayDate = parseIsoDate(today)
    // Grid ends on today's week (Monday-first).
    const dayOfWeek = (todayDate.getDay() + 6) % 7 // 0 = Monday
    const gridEnd = addDays(todayDate, 6 - dayOfWeek)
    const columns: { date: string; state: 'done' | 'miss' | 'future' }[][] = []
    for (let w = WEEKS_SHOWN - 1; w >= 0; w--) {
      const col: { date: string; state: 'done' | 'miss' | 'future' }[] = []
      for (let d = 6; d >= 0; d--) {
        const date = toIsoDate(addDays(gridEnd, -(w * 7 + d)))
        col.push({
          date,
          state: date > today ? 'future' : done.has(date) ? 'done' : 'miss',
        })
      }
      columns.push(col)
    }
    return columns
  }, [completedDates, today])

  return (
    <div className="mt-3 flex justify-between gap-[3px]" aria-hidden>
      {cells.map((col, i) => (
        <div key={i} className="flex flex-1 flex-col gap-[3px]">
          {col.map((cell) => (
            <div
              key={cell.date}
              title={cell.date}
              className={`aspect-square w-full rounded-[3px] ${
                cell.state === 'done'
                  ? 'bg-accent'
                  : cell.state === 'miss'
                    ? 'bg-raised'
                    : 'bg-transparent'
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
