import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { relativeTime } from '@/lib/dates'
import type { QueryErrorKind } from '@/hooks/useCachedQuery'

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`block w-full rounded-(--radius-card) border border-line bg-surface p-4 text-left ${
        onClick ? 'active:bg-raised transition-colors' : ''
      } ${className}`}
    >
      {children}
    </Tag>
  )
}

type Tone = 'neutral' | 'accent' | 'danger' | 'ok' | 'warn'

const badgeTones: Record<Tone, string> = {
  neutral: 'bg-raised text-muted',
  accent: 'bg-accent-dim text-accent',
  danger: 'bg-danger-dim text-danger',
  ok: 'bg-ok-dim text-ok',
  warn: 'bg-warn-dim text-warn',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide ${badgeTones[tone]}`}
    >
      {children}
    </span>
  )
}

export function SectionHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-baseline justify-between px-1 first:mt-0">
      <h2 className="text-[13px] font-semibold tracking-[0.08em] text-faint uppercase">
        {children}
      </h2>
      {right}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-raised ${className}`} />
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <div className="text-3xl opacity-60">{icon}</div>
      <div className="text-sm font-medium text-muted">{title}</div>
      {hint !== undefined && <div className="max-w-60 text-xs text-faint">{hint}</div>}
    </div>
  )
}

/** Per-error-kind copy so the user can tell VPN-off from bad-token (F1/F4). */
const errorCopy: Record<QueryErrorKind, { icon: string; title: string; hint: string }> = {
  timeout: {
    icon: '⏱',
    title: 'Agent not answering',
    hint: 'The Tailscale route looks down — check that the VPN is on and the host is awake.',
  },
  network: {
    icon: '📡',
    title: "Can't reach the agent",
    hint: 'No route to the agent. Check connectivity and the base URL in Settings.',
  },
  auth: {
    icon: '🔑',
    title: 'Agent rejected the token',
    hint: 'The bearer token is wrong or was revoked. Update it in Settings.',
  },
  server: {
    icon: '⚠️',
    title: 'Agent error',
    hint: 'The agent answered with an error. Check its logs on the VPS.',
  },
  invalid: {
    icon: '🧩',
    title: 'Unexpected response',
    hint: 'The payload failed validation — details under Settings → Debug.',
  },
  unknown: {
    icon: '📡',
    title: 'Something went wrong',
    hint: 'Unexpected failure while loading.',
  },
}

export function ErrorState({
  message,
  kind,
  onRetry,
}: {
  message?: string
  kind?: QueryErrorKind | null
  onRetry?: () => void
}) {
  const navigate = useNavigate()
  const copy = kind != null ? errorCopy[kind] : null
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-3xl opacity-60">{copy?.icon ?? '📡'}</div>
      <div className="text-sm font-medium text-muted">
        {copy?.title ?? message ?? 'Agent unreachable and no cached data yet'}
      </div>
      {copy !== null && <div className="max-w-64 text-xs text-faint">{copy.hint}</div>}
      <div className="flex gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-full bg-raised px-4 py-1.5 text-sm font-medium text-ink active:opacity-70"
          >
            Try again
          </button>
        )}
        {(kind === 'auth' || kind === 'network' || kind === 'invalid') && (
          <button
            onClick={() => void navigate('/settings')}
            className="bg-accent-dim text-accent rounded-full px-4 py-1.5 text-sm font-medium active:opacity-70"
          >
            Open Settings
          </button>
        )}
      </div>
    </div>
  )
}

/** "Stale since …" banner shown when data comes from the offline cache. */
export function StaleBanner({ since }: { since: string | null }) {
  if (since === null) return null
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-warn-dim px-3 py-2 text-xs text-warn">
      <span aria-hidden>⚠︎</span>
      <span>
        Agent unreachable — showing data from {relativeTime(since)} ({new Date(since).toLocaleString()})
      </span>
    </div>
  )
}
