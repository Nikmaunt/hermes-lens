import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { relativeTime } from '@/lib/dates'
import type { QueryErrorKind } from '@/hooks/useCachedQuery'
import {
  CircleAlertIcon,
  ClockIcon,
  KeyIcon,
  TriangleAlertIcon,
  WifiOffIcon,
  type IconComponent,
} from '@/components/icons'

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
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium tracking-wide ${badgeTones[tone]}`}
    >
      {children}
    </span>
  )
}

export function SectionHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-baseline justify-between px-1 first:mt-0">
      <h2 className="text-body-sm font-semibold tracking-[0.08em] text-faint uppercase">
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

/** Today: inbox pill, then two card sections and a headline block. */
export function TodaySkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16" />
      <Skeleton className="mt-4 h-3 w-28" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
    </div>
  )
}

/** Timeline: day header then icon + two-line rows with a trailing time. */
export function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <Skeleton className="mb-3 h-3 w-24" />
      <div className="space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-5 w-5 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Habits: name row + heat grid per card. */
export function HabitsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-line bg-surface rounded-(--radius-card) border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
            <Skeleton className="h-7 w-10" />
          </div>
          <Skeleton className="mt-3 h-16" />
        </div>
      ))}
    </div>
  )
}

/** People: tall cards with a name/badge header and text body. */
export function PeopleSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-line bg-surface rounded-(--radius-card) border p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-2.5 w-20" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <div className="text-faint opacity-80">{icon}</div>
      <div className="text-sm font-medium text-muted">{title}</div>
      {hint !== undefined && <div className="max-w-60 text-xs text-faint">{hint}</div>}
    </div>
  )
}

/** Per-error-kind copy so the user can tell VPN-off from bad-token (F1/F4). */
const errorCopy: Record<QueryErrorKind, { icon: IconComponent; title: string; hint: string }> = {
  timeout: {
    icon: ClockIcon,
    title: 'Agent not answering',
    hint: 'The Tailscale route looks down — check that the VPN is on and the host is awake.',
  },
  network: {
    icon: WifiOffIcon,
    title: "Can't reach the agent",
    hint: 'No route to the agent. Check connectivity and the base URL in Settings.',
  },
  auth: {
    icon: KeyIcon,
    title: 'Agent rejected the token',
    hint: 'The bearer token is wrong or was revoked. Update it in Settings.',
  },
  server: {
    icon: TriangleAlertIcon,
    title: 'Agent error',
    hint: 'The agent answered with an error. Check its logs on the VPS.',
  },
  invalid: {
    icon: CircleAlertIcon,
    title: 'Unexpected response',
    hint: 'The payload failed validation — details under Settings → Debug.',
  },
  unknown: {
    icon: WifiOffIcon,
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
  const Icon = copy?.icon ?? WifiOffIcon
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-faint opacity-80">
        <Icon size={30} />
      </div>
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

/**
 * Blocking confirmation for destructive actions (remove PIN, discard a
 * queued action). Small, centered, and impossible to trigger by accident.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="bg-bg/95 fixed inset-0 z-50 flex items-center justify-center px-8 backdrop-blur-sm"
    >
      <div className="border-line bg-surface animate-expand w-full max-w-xs rounded-(--radius-card) border p-5">
        <div className="text-title font-semibold">{title}</div>
        <p className="mt-2 text-sm leading-snug text-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-medium text-muted active:bg-raised"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="bg-danger-dim text-danger rounded-full px-4 py-2 text-sm font-semibold active:opacity-70"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** "Stale since …" banner shown when data comes from the offline cache. */
export function StaleBanner({ since }: { since: string | null }) {
  if (since === null) return null
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-warn-dim px-3 py-2 text-xs text-warn">
      <TriangleAlertIcon size={14} className="shrink-0" />
      <span>
        Agent unreachable — showing data from {relativeTime(since)} ({new Date(since).toLocaleString()})
      </span>
    </div>
  )
}
