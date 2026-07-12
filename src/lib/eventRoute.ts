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
 * Machine-readable event kinds and where they lead. `null` = the row expands
 * in place (no detail screen behind it). Kinds the table does not know also
 * expand in place — the safe default for whatever a newer sidecar invents.
 *
 * Keys are free strings by contract (TimelineEvent.kind is NOT an enum): the
 * server adds kinds ahead of the app, the app routes the ones it understands.
 */
const KIND_TARGETS: Record<string, string | null> = {
  // Journal records with no screen of their own: expand in place.
  notification: null,
  // The captured note lands in the inbox deck.
  capture: '/inbox',
  // Queued write-acks follow the item to where its pending state shows.
  'triage-queued': '/inbox',
  'followup-queued': '/',
  'habit-queued': '/habits',
  'memory-flag': '/memory',
  // Infra events: live agent state is on the Status screen.
  backup: '/status',
  cron: '/status',
}

/**
 * FRAGILE (legacy fallback): on events without `kind` — an older sidecar —
 * queued write-acks are recognized by the verbatim journal title the sidecar
 * writes (hermes-lens-sidecar src/writes/queue.ts). A sidecar retitle
 * silently demotes these rows back to in-place expansion; kind-bearing
 * events never hit this path. eventRoute.test.ts pins the exact prefixes
 * against the sidecar's current titles.
 */
const QUEUED_ACK_TARGETS: readonly { prefix: string; route: string }[] = [
  // The triaged item came from the inbox deck; that deck floats the
  // highlighted item back to the top if it is still there.
  { prefix: 'Inbox triage queued', route: '/inbox' },
  // Follow-up actions surface as pendingAction chips on Today's list.
  { prefix: 'Follow-up action queued', route: '/' },
]

/**
 * Tap target for Timeline rows specifically.
 *
 * When the event carries a machine-readable `kind`, KIND_TARGETS decides —
 * including "expand in place" for kinds the table (or this app version) does
 * not know. Category and title matching are never consulted for kind-bearing
 * events.
 *
 * Without `kind` (older sidecar), the legacy rules apply. System events
 * differ from the shared map: on the Timeline they are mostly journal records
 * (notification captures, sync acks) and /status shows live agent state, not
 * the tapped event — a blind jump. Those rows expand in place instead, like
 * agent rows. The exception is queued write-acks: they describe an item that
 * lives on a specific screen, so the tap follows the item (see
 * QUEUED_ACK_TARGETS). Today's digest keeps `eventTarget` — it has no
 * expansion affordance.
 */
export function timelineEventTarget(
  category: EventCategory,
  relatedId: string | null = null,
  title: string | null = null,
  kind: string | null = null,
): EventTarget | null {
  if (kind !== null) {
    const route = KIND_TARGETS[kind] ?? null
    if (route === null) return null
    // Status shows live state, nothing to flash there — no highlight hint.
    if (route === '/status') return { route }
    return relatedId === null ? { route } : { route, highlightId: relatedId }
  }
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
