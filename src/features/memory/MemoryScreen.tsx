import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
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
import { useSnackbar } from '@/components/SnackbarProvider'
import { useMemoryItems } from '@/hooks/queries'
import { useFlagMemory } from '@/hooks/mutations'
import { relativeTime } from '@/lib/dates'
import { MemoryCategory, type MemoryItem } from '@/schemas'
import { useAuth } from '../lock/LockGate'

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: 'Identity',
  preferences: 'Preferences',
  health: 'Health',
  routines: 'Routines',
  plans: 'Plans',
  relationships: 'Relationships',
  finance: 'Finance',
  misc: 'Misc',
}

export function MemoryScreen() {
  const { data, staleSince, isLoading, error, refetch } = useMemoryItems()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const categoryParam = searchParams.get('category')
  const category = MemoryCategory.options.find((c) => c === categoryParam)
  const topic = searchParams.get('topic')

  const items = useMemo(() => {
    let list = data?.items ?? []
    if (category !== undefined) list = list.filter((i) => i.category === category)
    if (topic !== null) list = list.filter((i) => i.topic === topic)
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [data, category, topic])

  return (
    <Screen
      title="Memory"
      actions={
        <button
          aria-label="Memory map"
          onClick={() => void navigate('/memory/map')}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-raised"
        >
          🕸
        </button>
      }
    >
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <Chip
          active={category === undefined && topic === null}
          onClick={() => setSearchParams({})}
        >
          All
        </Chip>
        {MemoryCategory.options.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setSearchParams({ category: c })}>
            {CATEGORY_LABELS[c]}
          </Chip>
        ))}
      </div>
      {topic !== null && (
        <div className="mb-2 px-1 text-xs text-faint">
          topic: <span className="text-accent font-medium">{topic}</span>{' '}
          <button className="underline" onClick={() => setSearchParams({})}>
            clear
          </button>
        </div>
      )}

      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={6} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            message="Agent unreachable and no cached data yet"
            onRetry={() => void refetch()}
          />
        )}
        {!isLoading && data !== undefined && items.length === 0 && (
          <EmptyState icon="◈" title="Nothing in this slice of memory" />
        )}
        <div className="space-y-2">
          {items.map((item) => (
            <MemoryCard key={item.id} item={item} />
          ))}
        </div>
      </PullToRefresh>
    </Screen>
  )
}

function MemoryCard({ item }: { item: MemoryItem }) {
  const [revealed, setRevealed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { requestAuth } = useAuth()
  const flag = useFlagMemory()
  const snackbar = useSnackbar()

  const hidden = item.sensitivity === 'sensitive' && !revealed

  const reveal = async () => {
    if (await requestAuth('Reveal sensitive memory')) setRevealed(true)
  }

  const requestFlag = (action: 'forget' | 'mark-sensitive') => {
    flag.mutate(
      { itemId: item.id, action },
      {
        onSuccess: ({ queued }) => {
          snackbar.show({
            message: queued
              ? 'Request queued — will reach the agent when online'
              : action === 'forget'
                ? 'Forget request sent to the agent'
                : 'Marked for sensitivity review',
          })
        },
      },
    )
  }

  return (
    <Card onClick={hidden ? () => void reveal() : () => setExpanded((e) => !e)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">
              {item.topic}
            </span>
            {item.sensitivity === 'sensitive' && <Badge tone="danger">sensitive</Badge>}
            {item.pendingFlag !== null && (
              <Badge tone="warn">
                {item.pendingFlag.action === 'forget' ? 'forget' : 'sensitivity'} · pending agent
                confirmation
              </Badge>
            )}
          </div>
          {hidden ? (
            <div className="text-sm text-faint italic select-none">
              Hidden — tap to unlock with biometrics
            </div>
          ) : (
            <div className="text-sm leading-snug">{item.fact}</div>
          )}
          <div className="mt-1.5 text-[11px] text-faint">
            {item.source} · updated {relativeTime(item.updatedAt)}
          </div>
        </div>
      </div>
      {expanded && !hidden && item.pendingFlag === null && (
        <div className="mt-3 flex gap-2 border-t border-line pt-3">
          <ActionButton
            label="Request forget"
            tone="danger"
            disabled={flag.isPending}
            onClick={() => requestFlag('forget')}
          />
          {item.sensitivity === 'normal' && (
            <ActionButton
              label="Mark sensitive"
              tone="warn"
              disabled={flag.isPending}
              onClick={() => requestFlag('mark-sensitive')}
            />
          )}
        </div>
      )}
    </Card>
  )
}

function ActionButton({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string
  tone: 'danger' | 'warn'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <span
      role="button"
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onClick()
      }}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
        tone === 'danger' ? 'bg-danger-dim text-danger' : 'bg-warn-dim text-warn'
      } ${disabled ? 'opacity-50' : 'active:opacity-70'}`}
    >
      {label}
    </span>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? 'bg-accent text-accent-ink' : 'bg-surface border border-line text-muted'
      }`}
    >
      {children}
    </button>
  )
}
