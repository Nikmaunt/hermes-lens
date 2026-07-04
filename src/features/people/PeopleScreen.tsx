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
import { usePeople } from '@/hooks/queries'
import { formatDate, relativeTime } from '@/lib/dates'

export function PeopleScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = usePeople()

  return (
    <Screen title="People" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined && data.people.length === 0 && (
          <EmptyState icon="👥" title="Nobody here yet" />
        )}
        <div className="space-y-3">
          {data?.people.map((person) => (
            <Card key={person.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[16px] font-semibold tracking-tight">{person.name}</div>
                  <div className="mt-0.5 text-[12px] text-faint">{person.relation}</div>
                </div>
                <Badge tone="neutral">🗣 {person.preferredLanguage}</Badge>
              </div>
              <p className="mt-2 text-[13px] leading-snug text-muted">{person.context}</p>

              {person.agreements.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">
                    agreements
                  </div>
                  {person.agreements.map((agreement) => (
                    <div key={agreement.id} className="flex items-start gap-2 text-[13px]">
                      <span
                        className={agreement.status === 'done' ? 'text-ok' : 'text-warn'}
                        aria-hidden
                      >
                        {agreement.status === 'done' ? '✓' : '○'}
                      </span>
                      <span
                        className={`flex-1 leading-snug ${
                          agreement.status === 'done' ? 'text-faint line-through' : ''
                        }`}
                      >
                        {agreement.text}
                      </span>
                      <span className="tnum text-[11px] whitespace-nowrap text-faint">
                        {formatDate(agreement.madeOn)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {person.lastInteraction !== null && (
                <div className="mt-3 border-t border-line pt-2.5">
                  <div className="text-[11px] text-faint">
                    last contact · {person.lastInteraction.channel} ·{' '}
                    {relativeTime(person.lastInteraction.at)}
                  </div>
                  <div className="mt-1 text-[13px] leading-snug text-muted">
                    {person.lastInteraction.summary}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      </PullToRefresh>
    </Screen>
  )
}
