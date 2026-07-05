import type { EventCategory } from '@/schemas'

export interface EventTarget {
  route: string
  /** Entity to scroll to and flash on arrival (useHighlightScroll). */
  highlightId?: string
}

/**
 * Where a timeline event or Today activity row leads on tap. One map for
 * both screens so they can never disagree.
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
