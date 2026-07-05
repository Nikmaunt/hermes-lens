import type { KV } from '@/data/kv'
import type { TriageDestination } from '@/schemas'

/*
 * Client-only sliding-window log of recent triages. A swiped note must not
 * vanish instantly: while its mutation waits in the offline queue — or after
 * the server already hid it — the Inbox shows it in a dimmed "Processing"
 * section. The queue knows pending triages; once flushed, only this log
 * still knows what was sent where, so entries live for 48 hours.
 */

const KEY = 'inbox:processing-log'
const WINDOW_MS = 48 * 60 * 60 * 1000

export interface ProcessingEntry {
  itemId: string
  /** Raw note text captured at triage time — the server hides the item after. */
  text: string
  destination: TriageDestination
  at: string
}

function withinWindow(entry: ProcessingEntry, now: Date): boolean {
  const t = new Date(entry.at).getTime()
  return Number.isFinite(t) && now.getTime() - t <= WINDOW_MS
}

async function loadRaw(kv: KV): Promise<ProcessingEntry[]> {
  const raw = await kv.get(KEY)
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ProcessingEntry[]) : []
  } catch {
    return []
  }
}

/** Entries still inside the 48 h window, newest first. */
export async function loadProcessingLog(kv: KV, now = new Date()): Promise<ProcessingEntry[]> {
  return (await loadRaw(kv))
    .filter((e) => withinWindow(e, now))
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** Drop an entry (the user undid the swipe before the triage fired). */
export async function removeFromProcessingLog(kv: KV, itemId: string): Promise<void> {
  const kept = (await loadRaw(kv)).filter((e) => e.itemId !== itemId)
  await kv.set(KEY, JSON.stringify(kept))
}

/** Append a triage; replaces an older entry for the same item and prunes stale ones. */
export async function appendProcessingLog(
  kv: KV,
  entry: ProcessingEntry,
  now = new Date(),
): Promise<void> {
  const kept = (await loadRaw(kv)).filter(
    (e) => e.itemId !== entry.itemId && withinWindow(e, now),
  )
  kept.push(entry)
  await kv.set(KEY, JSON.stringify(kept))
}
