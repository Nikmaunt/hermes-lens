import { useMemo } from 'react'
import { PullToRefresh } from '@/components/PullToRefresh'
import { Screen } from '@/components/Screen'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  StaleBanner,
} from '@/components/primitives'
import { DueBadge } from '@/components/DueBadge'
import {
  FileTextIcon,
  IdCardIcon,
  RefreshIcon,
  ScrollTextIcon,
  ShieldIcon,
  type IconComponent,
} from '@/components/icons'
import { useDocuments } from '@/hooks/queries'
import { useHighlightScroll } from '@/hooks/useHighlightScroll'
import { daysUntil, formatDate } from '@/lib/dates'
import { formatMoney } from '@/lib/fmt'
import type { DocumentItem } from '@/schemas'

const KIND_ICONS: Record<DocumentItem['kind'], IconComponent> = {
  contract: ScrollTextIcon,
  subscription: RefreshIcon,
  insurance: ShieldIcon,
  'id-document': IdCardIcon,
}

/** Sort by the most pressing upcoming date (cancelBy beats renewsOn). */
function nextDate(doc: DocumentItem): string | null {
  if (doc.cancelBy !== null && daysUntil(doc.cancelBy) >= 0) return doc.cancelBy
  return doc.renewsOn
}

export function DocumentsScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useDocuments()

  useHighlightScroll(data !== undefined)

  const sorted = useMemo(() => {
    const items = [...(data?.items ?? [])]
    items.sort((a, b) => {
      const da = nextDate(a)
      const db = nextDate(b)
      if (da === null) return 1
      if (db === null) return -1
      return da.localeCompare(db)
    })
    return items
  }, [data])

  return (
    <Screen title="Documents & Money" back>
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
            <Card className="bg-raised">
              <div className="text-micro font-semibold tracking-wide text-faint uppercase">
                recurring spend / month
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {data.monthlyTotal.map((total) => (
                  <span key={total.currency} className="tnum text-xl font-semibold tracking-tight">
                    {formatMoney(total)}
                  </span>
                ))}
              </div>
            </Card>

            <SectionHeader>Contracts & subscriptions</SectionHeader>
            {sorted.length === 0 && (
              <EmptyState icon={<FileTextIcon size={30} />} title="No documents tracked" />
            )}
            <div className="space-y-2">
              {sorted.map((doc) => {
                const cancelSoon =
                  doc.cancelBy !== null &&
                  daysUntil(doc.cancelBy) >= 0 &&
                  daysUntil(doc.cancelBy) <= 14
                const KindIcon = KIND_ICONS[doc.kind]
                return (
                  <div key={doc.id} data-item-id={doc.id}>
                  <Card className={cancelSoon ? 'border-danger/40' : ''}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm leading-snug font-medium">
                          <span className="shrink-0 text-faint" aria-hidden>
                            <KindIcon size={15} />
                          </span>
                          {doc.title}
                        </div>
                        <div className="mt-0.5 text-caption text-faint">{doc.provider}</div>
                      </div>
                      {doc.amount !== null && (
                        <div className="text-right">
                          <div className="tnum text-sm font-semibold">
                            {formatMoney(doc.amount)}
                          </div>
                          {doc.billingPeriod !== null && (
                            <div className="text-micro text-faint">/{doc.billingPeriod === 'monthly' ? 'mo' : 'yr'}</div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {cancelSoon && doc.cancelBy !== null && (
                        <Badge tone="danger">cancel by {formatDate(doc.cancelBy)}</Badge>
                      )}
                      {!cancelSoon && doc.cancelBy !== null && daysUntil(doc.cancelBy) >= 0 && (
                        <DueBadge date={doc.cancelBy} tone="warn" prefix="cancel window" />
                      )}
                      {doc.renewsOn !== null && (
                        <DueBadge
                          date={doc.renewsOn}
                          tone={daysUntil(doc.renewsOn) <= 7 ? 'warn' : 'neutral'}
                          prefix="renews"
                        />
                      )}
                    </div>

                    {doc.notes !== null && (
                      <p className="mt-2 text-label leading-snug text-faint">{doc.notes}</p>
                    )}
                  </Card>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </PullToRefresh>
    </Screen>
  )
}
