import { useMemo } from 'react'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  StaleBanner,
} from '@/components/primitives'
import { useHabits } from '@/hooks/queries'
import { addDays, parseIsoDate, toIsoDate } from '@/lib/dates'
import { bestStreak, completionRate, currentStreak } from '@/lib/streaks'

const WEEKS_SHOWN = 12

export function HabitsScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useHabits()
  const today = toIsoDate(new Date())

  return (
    <Screen title="Habits" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined && data.habits.length === 0 && (
          <EmptyState icon="🔥" title="No habits tracked" hint="The agent logs these from your routines." />
        )}
        <div className="space-y-3">
          {data?.habits.map((habit) => {
            const streak = currentStreak(habit.completedDates, today)
            const best = bestStreak(habit.completedDates)
            const rate = completionRate(habit.completedDates, habit.startedOn, today)
            return (
              <Card key={habit.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl" aria-hidden>
                      {habit.icon}
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{habit.name}</div>
                      <div className="tnum mt-0.5 text-[11px] text-faint">
                        best {best}d · {Math.round(rate * 100)}% since start
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-xl font-semibold tracking-tight">
                      {streak}
                      <span className="ml-0.5 text-sm" aria-hidden>
                        🔥
                      </span>
                    </div>
                    <div className="text-[10px] text-faint">day streak</div>
                  </div>
                </div>
                <HeatGrid completedDates={habit.completedDates} today={today} />
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
