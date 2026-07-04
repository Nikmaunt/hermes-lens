import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PeopleSkeleton,
  StaleBanner,
} from '@/components/primitives'
import { MessageCircleIcon, UsersIcon } from '@/components/icons'
import { usePeople } from '@/hooks/queries'
import { useHighlightScroll } from '@/hooks/useHighlightScroll'
import { formatDate, relativeTime } from '@/lib/dates'

export function PeopleScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = usePeople()

  useHighlightScroll(data !== undefined)

  return (
    <Screen title="People" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <PeopleSkeleton rows={3} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState
            kind={errorKind}
            onRetry={() => void refetch()}
          />
        )}
        {data !== undefined && data.people.length === 0 && (
          <EmptyState
            icon={<UsersIcon size={30} />}
            title="Nobody here yet"
            hint="Person cards grow out of your conversations and notes as the agent meets people with you."
          />
        )}
        <div className="space-y-3">
          {data?.people.map((person) => (
            <div key={person.id} data-item-id={person.id}>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-title font-semibold tracking-tight">{person.name}</div>
                  <div className="mt-0.5 text-label text-faint">{person.relation}</div>
                </div>
                <Badge tone="neutral">
                  <MessageCircleIcon size={11} /> {person.preferredLanguage}
                </Badge>
              </div>
              <p className="mt-2 text-body-sm leading-snug text-muted">{person.context}</p>

              {person.agreements.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-micro font-semibold tracking-wide text-faint uppercase">
                    agreements
                  </div>
                  {person.agreements.map((agreement) => (
                    <div key={agreement.id} className="flex items-start gap-2 text-body-sm">
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
                      <span className="tnum text-caption whitespace-nowrap text-faint">
                        {formatDate(agreement.madeOn)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {person.lastInteraction !== null && (
                <div className="mt-3 border-t border-line pt-2.5">
                  <div className="text-caption text-faint">
                    last contact · {person.lastInteraction.channel} ·{' '}
                    {relativeTime(person.lastInteraction.at)}
                  </div>
                  <div className="mt-1 text-body-sm leading-snug text-muted">
                    {person.lastInteraction.summary}
                  </div>
                </div>
              )}
            </Card>
            </div>
          ))}
        </div>
      </PullToRefresh>
    </Screen>
  )
}
