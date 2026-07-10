import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, ListSkeleton, StaleBanner } from '@/components/primitives'
import { ArchiveIcon } from '@/components/icons'
import { useSomeday } from '@/hooks/queries'
import { SomedayList } from './SomedayList'

export function SomedayScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useSomeday()

  return (
    <Screen title="Someday" back>
      <PullToRefresh onRefresh={refetch}>
        <StaleBanner since={staleSince} />
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && error !== null && data === undefined && (
          <ErrorState kind={errorKind} onRetry={() => void refetch()} />
        )}
        {data !== undefined && data.items.length === 0 && (
          <EmptyState
            icon={<ArchiveIcon size={30} />}
            title="Nothing parked for someday"
            hint="Send a follow-up here with “Someday” and it waits without a due date."
          />
        )}
        {data !== undefined && <SomedayList items={data.items} />}
      </PullToRefresh>
    </Screen>
  )
}
