import type { EventCategory } from '@/schemas'

export interface EventTarget {
  route: string
  /** Entity to scroll to and flash on arrival (useHighlightScroll). */
  highlightId?: string
}

/**
 * Where a timeline event or Today activity row leads on tap. One map for
 * both screens so they can never disagree — the Timeline overrides only the
 * system case via `timelineEventTarget` below.
 *
 * `null` means the row deliberately has no destination: agent events (cron
 * runs, chat sessions, briefs) have no detail view by design — their bodies
 * are privacy-restricted and stay on the VPS. Callers show a toast instead.
 *
 * relatedId travels as a highlight hint, never as a route: id formats belong
 * to the server, so a missing or unknown id degrades to the list root.
 */
export function eventTarget(
  category: EventCategory,
  relatedId: string | null = null,
): EventTarget | null {
  const withHighlight = (route: string): EventTarget =>
    relatedId === null ? { route } : { route, highlightId: relatedId }
  switch (category) {
    case 'capture':
      // The inbox deck floats the highlighted item to the top if it is
      // still untriaged; otherwise the tap lands on the Inbox root.
      return withHighlight('/inbox')
    case 'memory':
      return withHighlight('/memory')
    case 'system':
      // Backups, cron health, disk — all live on the Status screen.
      return { route: '/status' }
    case 'habit':
      return withHighlight('/habits')
    case 'people':
      return withHighlight('/people')
    case 'project':
      return withHighlight('/projects')
    case 'document':
      return withHighlight('/documents')
    case 'agent':
      return null
  }
}

/**
 * FRAGILE: queued write-acks are journal records whose only machine-readable
 * shape is the verbatim title the sidecar writes (hermes-lens-sidecar
 * src/writes/queue.ts). Until the contract grows an event `kind` (planned for
 * Pack 2), they are recognized by title prefix — a sidecar retitle silently
 * demotes these rows back to in-place expansion. eventRoute.test.ts pins the
 * exact prefixes against the sidecar's current titles.
 */
const QUEUED_ACK_TARGETS: readonly { prefix: string; route: string }[] = [
  // The triaged item came from the inbox deck; that deck floats the
  // highlighted item back to the top if it is still there.
  { prefix: 'Inbox triage queued', route: '/inbox' },
  // Follow-up actions surface as pendingAction chips on Today's list.
  { prefix: 'Follow-up action queued', route: '/' },
]

/**
 * Tap target for Timeline rows specifically. System events differ from the
 * shared map: on the Timeline they are mostly journal records (notification
 * captures, sync acks) and /status shows live agent state, not the tapped
 * event — a blind jump. Those rows expand in place instead, like agent rows.
 * The exception is queued write-acks: they describe an item that lives on a
 * specific screen, so the tap follows the item (see QUEUED_ACK_TARGETS).
 * Today's digest keeps `eventTarget` — it has no expansion affordance.
 */
export function timelineEventTarget(
  category: EventCategory,
  relatedId: string | null = null,
  title: string | null = null,
): EventTarget | null {
  if (category === 'system') {
    const ack =
      title === null ? undefined : QUEUED_ACK_TARGETS.find((t) => title.startsWith(t.prefix))
    if (ack === undefined) return null
    return relatedId === null
      ? { route: ack.route }
      : { route: ack.route, highlightId: relatedId }
  }
  return eventTarget(category, relatedId)
}
