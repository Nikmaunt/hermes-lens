import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  Card,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  StaleBanner,
} from '@/components/primitives'
import { useStatus } from '@/hooks/queries'
import { relativeTime } from '@/lib/dates'

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1)
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`
}

export function StatusScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useStatus()

  return (
    <Screen title="Agent Status" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={5} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined && (
          <>
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Telegram gateway</div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    heartbeat {relativeTime(data.gateway.lastHeartbeat)}
                  </div>
                </div>
                <Badge tone={data.gateway.alive ? 'ok' : 'danger'}>
                  {data.gateway.alive ? '● alive' : '● down'}
                </Badge>
              </div>
            </Card>

            <SectionHeader>Cron jobs</SectionHeader>
            <Card className="divide-y divide-line p-0">
              {data.cronJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{job.name}</div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      {job.schedule} · ran {relativeTime(job.lastRun)}
                    </div>
                  </div>
                  <Badge
                    tone={
                      job.lastResult === 'ok' ? 'ok' : job.lastResult === 'error' ? 'danger' : 'neutral'
                    }
                  >
                    {job.lastResult}
                  </Badge>
                </div>
              ))}
            </Card>

            <SectionHeader>Backup</SectionHeader>
            <Card>
              {data.lastBackup === null ? (
                <div className="text-danger text-sm font-medium">No backup recorded ⚠</div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{relativeTime(data.lastBackup.at)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-faint">
                      {data.lastBackup.target}
                    </div>
                  </div>
                  <span className="tnum text-sm text-muted">
                    {(data.lastBackup.sizeBytes / 1024 ** 2).toFixed(0)} MB
                  </span>
                </div>
              )}
            </Card>

            <SectionHeader>VPS</SectionHeader>
            <Card className="space-y-4">
              <Meter
                label="Disk"
                value={data.system.diskUsedBytes}
                total={data.system.diskTotalBytes}
                text={`${gb(data.system.diskUsedBytes)} / ${gb(data.system.diskTotalBytes)} GB`}
              />
              <Meter
                label="RAM"
                value={data.system.ramUsedBytes}
                total={data.system.ramTotalBytes}
                text={`${gb(data.system.ramUsedBytes)} / ${gb(data.system.ramTotalBytes)} GB`}
              />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Uptime</span>
                <span className="tnum">{uptime(data.system.uptimeSeconds)}</span>
              </div>
            </Card>

            <SectionHeader>Token spend</SectionHeader>
            <Card>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="tnum text-2xl font-semibold tracking-tight">
                    ${data.tokenSpend.todayUsd.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-faint">today</div>
                </div>
                <div className="text-right">
                  <div className="tnum text-lg font-medium text-muted">
                    ${data.tokenSpend.monthUsd.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-faint">this month</div>
                </div>
              </div>
            </Card>
          </>
        )}
      </PullToRefresh>
    </Screen>
  )
}

function Meter({
  label,
  value,
  total,
  text,
}: {
  label: string
  value: number
  total: number
  text: string
}) {
  const ratio = Math.min(1, value / total)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="tnum text-xs text-faint">{text}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full rounded-full ${ratio > 0.85 ? 'bg-danger' : ratio > 0.7 ? 'bg-warn' : 'bg-accent'}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
