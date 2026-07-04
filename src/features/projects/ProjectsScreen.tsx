import { useNavigate } from 'react-router'
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
import { useProjects } from '@/hooks/queries'
import { formatDate, relativeTime } from '@/lib/dates'
import type { Project } from '@/schemas'

const statusTone: Record<Project['status'], 'ok' | 'neutral' | 'accent'> = {
  active: 'ok',
  paused: 'neutral',
  done: 'accent',
}

export function ProjectsScreen() {
  const { data, staleSince, isLoading, error, refetch } = useProjects()
  const navigate = useNavigate()

  return (
    <Screen title="Projects" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            message="Agent unreachable and no cached data yet"
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined && data.projects.length === 0 && (
          <EmptyState icon="🗂" title="No projects tracked yet" />
        )}
        <div className="space-y-3">
          {data?.projects.map((project) => (
            <Card key={project.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-[16px] font-semibold tracking-tight">{project.name}</div>
                <Badge tone={statusTone[project.status]}>{project.status}</Badge>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-muted">{project.summary}</p>

              {project.nextAction !== null && (
                <div className="bg-accent-dim mt-3 rounded-lg px-3 py-2">
                  <div className="text-accent text-[10px] font-semibold tracking-wide uppercase">
                    next action
                  </div>
                  <div className="mt-0.5 text-[13px] leading-snug">{project.nextAction}</div>
                </div>
              )}

              {project.keyDates.length > 0 && (
                <div className="mt-3 space-y-1">
                  {project.keyDates.map((kd) => (
                    <div key={kd.label} className="flex justify-between text-[12px]">
                      <span className="text-faint">{kd.label}</span>
                      <span className="tnum text-muted">{formatDate(kd.date)}</span>
                    </div>
                  ))}
                </div>
              )}

              {project.linkedNotes.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {project.linkedNotes.map((note) => (
                    <span
                      key={note.id}
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted"
                      title={`updated ${relativeTime(note.updatedAt)}`}
                    >
                      🗒 {note.title}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                <span className="text-[11px] text-faint">
                  updated {relativeTime(project.updatedAt)}
                </span>
                <button
                  onClick={() => void navigate(`/decisions?project=${project.id}`)}
                  className="text-xs font-medium text-faint active:opacity-70"
                >
                  decisions →
                </button>
              </div>
            </Card>
          ))}
        </div>
      </PullToRefresh>
    </Screen>
  )
}
