import type { KV } from '@/data/kv'

/*
 * Read/unread state for briefs is client-only: an id-set persisted through
 * the kv layer (Capacitor Preferences). The server has no read concept.
 */

const KEY = 'briefs:read'

export async function loadReadBriefIds(kv: KV): Promise<ReadonlySet<string>> {
  const raw = await kv.get(KEY)
  if (raw === null) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export async function markBriefRead(kv: KV, id: string): Promise<ReadonlySet<string>> {
  const read = new Set(await loadReadBriefIds(kv))
  if (!read.has(id)) {
    read.add(id)
    await kv.set(KEY, JSON.stringify([...read]))
  }
  return read
}

/** "Mark all read": union the listed ids into the read-set in one write. */
export async function markAllBriefsRead(
  kv: KV,
  ids: Iterable<string>,
): Promise<ReadonlySet<string>> {
  const read = new Set(await loadReadBriefIds(kv))
  const before = read.size
  for (const id of ids) read.add(id)
  if (read.size > before) await kv.set(KEY, JSON.stringify([...read]))
  return read
}
