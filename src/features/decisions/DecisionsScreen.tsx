import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
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
import { useDecisions, useProjects } from '@/hooks/queries'
import { daysUntil, formatDate } from '@/lib/dates'
import type { Decision } from '@/schemas'

export function DecisionsScreen() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectFilter = searchParams.get('project')
  const { data, staleSince, errorKind, isLoading, error, refetch } = useDecisions()
  const projects = useProjects()

  const projectName = (id: string | null): string | null =>
    id === null ? null : (projects.data?.projects.find((p) => p.id === id)?.name ?? null)

  const decisions = useMemo(() => {
    const list = data?.decisions ?? []
    const filtered = projectFilter === null ? list : list.filter((d) => d.projectId === projectFilter)
    return [...filtered].sort((a, b) => b.decidedOn.localeCompare(a.decidedOn))
  }, [data, projectFilter])

  return (
    <Screen title="Decision Log" back>
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <Chip active={projectFilter === null} onClick={() => setSearchParams({})}>
          All
        </Chip>
        {projects.data?.projects.map((p) => (
          <Chip
            key={p.id}
            active={projectFilter === p.id}
            onClick={() => setSearchParams({ project: p.id })}
          >
            {p.name}
          </Chip>
        ))}
      </div>

      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {!isLoading && data !== undefined && decisions.length === 0 && (
          <EmptyState icon="⚖️" title="No decisions recorded here" />
        )}
        <div className="space-y-3">
          {decisions.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              projectName={projectName(decision.projectId)}
            />
          ))}
        </div>
      </PullToRefresh>
    </Screen>
  )
}

function DecisionCard({
  decision,
  projectName,
}: {
  decision: Decision
  projectName: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const revisitDue =
    decision.revisitBy !== null && daysUntil(decision.revisitBy) <= 7

  return (
    <Card onClick={() => setExpanded((e) => !e)}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm leading-snug font-semibold">{decision.title}</div>
        <span className="tnum text-[11px] whitespace-nowrap text-faint">
          {formatDate(decision.decidedOn)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {projectName !== null && <Badge tone="accent">{projectName}</Badge>}
        {decision.revisitBy !== null && (
          <Badge tone={revisitDue ? 'warn' : 'neutral'}>
            revisit by {formatDate(decision.revisitBy)}
          </Badge>
        )}
      </div>
      {!expanded && (
        <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-muted">{decision.context}</p>
      )}
      {expanded && (
        <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
          <Block label="Context">{decision.context}</Block>
          <Block label="Reasoning">{decision.reasoning}</Block>
          {decision.alternatives.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">
                alternatives considered
              </div>
              <ul className="space-y-1">
                {decision.alternatives.map((alt) => (
                  <li key={alt} className="flex gap-2 text-muted">
                    <span className="text-faint" aria-hidden>
                      ·
                    </span>
                    {alt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Block({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">
        {label}
      </div>
      <p className="text-muted">{children}</p>
    </div>
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
