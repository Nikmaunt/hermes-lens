import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Screen } from '@/components/Screen'
import { Badge, ErrorState, ListSkeleton, StaleBanner } from '@/components/primitives'
import { NoteText } from '@/components/NoteText'
import { preferencesKV } from '@/data/kv'
import { useBrief } from '@/hooks/queries'
import { formatDate, formatTime } from '@/lib/dates'
import { markBriefRead } from './readStore'

export function BriefScreen() {
  const { id = '' } = useParams()
  const { data, staleSince, errorKind, isLoading, error, refetch } = useBrief(id)

  // Opening the brief is what marks it read — a client-only concept.
  useEffect(() => {
    if (data !== undefined) void markBriefRead(preferencesKV, data.id)
  }, [data])

  return (
    <Screen title="Brief" back>
      <StaleBanner since={staleSince} />
      {isLoading && <ListSkeleton rows={4} />}
      {!isLoading && error !== null && data === undefined && (
        <ErrorState kind={errorKind} onRetry={() => void refetch()} />
      )}
      {data !== undefined && (
        <>
          <div className="flex items-center gap-2">
            <Badge tone={data.kind === 'morning' ? 'accent' : 'neutral'}>{data.kind}</Badge>
            <span className="text-caption text-faint">{formatDate(data.date)}</span>
          </div>
          <h2 className="mt-3 text-title-lg leading-snug font-semibold">{data.title}</h2>
          <NoteText text={data.markdown} className="mt-4 text-body leading-relaxed" />
          <div className="mt-6 text-caption text-faint">
            generated {formatDate(data.generatedAt)} at {formatTime(data.generatedAt)}
          </div>
        </>
      )}
    </Screen>
  )
}
