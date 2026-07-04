import { useEffect, useMemo, useState } from 'react'
import { Screen } from '@/components/Screen'
import {
  Card,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  StaleBanner,
} from '@/components/primitives'
import { preferencesKV } from '@/data/kv'
import { usePolishWords } from '@/hooks/queries'
import { toIsoDate } from '@/lib/dates'
import { isDue, newCard, review, type CardState, type Grade } from '@/lib/srs'
import type { PolishWord } from '@/schemas'
import {
  bumpReviewedToday,
  loadReviewedToday,
  loadSrsState,
  saveSrsState,
  type SrsState,
} from './srsStore'

const SESSION_CAP = 20

const GRADE_BUTTONS: { grade: Grade; label: string; className: string }[] = [
  { grade: 0, label: 'Again', className: 'bg-danger-dim text-danger' },
  { grade: 1, label: 'Hard', className: 'bg-warn-dim text-warn' },
  { grade: 2, label: 'Good', className: 'bg-ok-dim text-ok' },
  { grade: 3, label: 'Easy', className: 'bg-accent-dim text-accent' },
]

export function PolishScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = usePolishWords()
  const today = toIsoDate(new Date())

  const [srs, setSrs] = useState<SrsState | null>(null)
  const [reviewedToday, setReviewedToday] = useState(0)
  const [session, setSession] = useState<PolishWord[] | null>(null)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    void loadSrsState(preferencesKV).then(setSrs)
    void loadReviewedToday(preferencesKV, today).then(setReviewedToday)
  }, [today])

  const words = useMemo(() => data?.words ?? [], [data])

  const stateOf = (wordId: string): CardState => srs?.[wordId] ?? newCard(today)

  const dueWords = useMemo(() => {
    if (srs === null) return []
    return words.filter((w) => isDue(stateOf(w.id), today))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, srs, today])

  const stats = useMemo(() => {
    let mature = 0
    let young = 0
    let fresh = 0
    for (const word of words) {
      const state = srs?.[word.id]
      if (state === undefined || state.reps === 0) fresh++
      else if (state.intervalDays >= 21) mature++
      else young++
    }
    return { mature, young, fresh }
  }, [words, srs])

  const startSession = () => {
    setSession(dueWords.slice(0, SESSION_CAP))
    setFlipped(false)
  }

  const grade = (g: Grade) => {
    if (session === null || srs === null) return
    const word = session[0]
    if (word === undefined) return
    const nextState = review(stateOf(word.id), g, today)
    const nextSrs = { ...srs, [word.id]: nextState }
    setSrs(nextSrs)
    void saveSrsState(preferencesKV, nextSrs)
    void bumpReviewedToday(preferencesKV, today).then(setReviewedToday)

    setSession((prev) => {
      if (prev === null) return null
      const rest = prev.slice(1)
      // "Again" keeps the card in this session's tail for relearning.
      return g === 0 ? [...rest, word] : rest
    })
    setFlipped(false)
  }

  const current = session?.[0]

  return (
    <Screen title="Polish words" back>
      <StaleBanner since={staleSince} />
      {isLoading && <ListSkeleton rows={4} />}
      {!isLoading && error !== null && data === undefined && (
        <ErrorState
          kind={errorKind}
          onRetry={() => void refetch()}
        />
      )}

      {data !== undefined && srs !== null && session === null && (
        <>
          <Card className="text-center">
            <div className="tnum text-4xl font-semibold tracking-tight">{dueWords.length}</div>
            <div className="mt-1 text-xs text-faint">cards due today</div>
            <button
              onClick={startSession}
              disabled={dueWords.length === 0}
              className="bg-accent text-accent-ink mt-4 w-full rounded-(--radius-card) py-3 text-body font-semibold active:opacity-80 disabled:opacity-30"
            >
              {dueWords.length === 0 ? 'All caught up ✓' : 'Start review'}
            </button>
          </Card>

          <SectionHeader>Progress</SectionHeader>
          <Card className="space-y-3">
            <StatBar label="Mature (21d+)" value={stats.mature} total={words.length} tone="bg-ok" />
            <StatBar label="Learning" value={stats.young} total={words.length} tone="bg-accent" />
            <StatBar label="New" value={stats.fresh} total={words.length} tone="bg-raised" />
            <div className="flex justify-between border-t border-line pt-3 text-sm">
              <span className="text-muted">Reviewed today</span>
              <span className="tnum">{reviewedToday}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Deck size</span>
              <span className="tnum">{words.length}</span>
            </div>
          </Card>
        </>
      )}

      {session !== null && current === undefined && (
        <Card className="py-10 text-center">
          <div className="text-3xl">🎉</div>
          <div className="mt-2 text-sm font-semibold">Session complete</div>
          <div className="mt-1 text-xs text-faint">{reviewedToday} reviews today</div>
          <button
            onClick={() => setSession(null)}
            className="bg-raised mt-5 rounded-full px-6 py-2 text-sm font-medium active:opacity-70"
          >
            Done
          </button>
        </Card>
      )}

      {current !== undefined && (
        <>
          <div className="mb-2 flex items-center justify-between px-1 text-caption text-faint">
            <span className="tnum">{session?.length} left</span>
            <button onClick={() => setSession(null)} className="active:opacity-70">
              end session
            </button>
          </div>
          <button
            onClick={() => setFlipped(true)}
            className="border-line bg-surface flex min-h-72 w-full flex-col items-center justify-center rounded-(--radius-card) border p-6 text-center"
          >
            <div className="text-3xl font-semibold tracking-tight">{current.word}</div>
            {flipped ? (
              <div className="animate-flip-in">
                <div className="text-accent mt-4 text-lg">{current.translation}</div>
                {current.example !== null && (
                  <div className="mt-3 text-sm leading-relaxed text-muted italic">
                    {current.example}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 text-xs text-faint">tap to reveal</div>
            )}
          </button>
          {flipped ? (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {GRADE_BUTTONS.map(({ grade: g, label, className }) => (
                <button
                  key={g}
                  onClick={() => grade(g)}
                  className={`rounded-xl py-3 text-sm font-semibold active:opacity-70 ${className}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 h-11" />
          )}
        </>
      )}
    </Screen>
  )
}

function StatBar({
  label,
  value,
  total,
  tone,
}: {
  label: string
  value: number
  total: number
  tone: string
}) {
  const pct = total === 0 ? 0 : (value / total) * 100
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="tnum text-xs text-faint">{value}</span>
      </div>
      <div className="bg-bg h-1.5 overflow-hidden rounded-full">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
