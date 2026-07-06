import type { KV } from '@/data/kv'

/*
 * Pinned briefs are client-only, mirroring the read-set: an id-set persisted
 * through the kv layer under "briefs:pinned". The server has no pin concept.
 */

const KEY = 'briefs:pinned'

export async function loadPinnedBriefIds(kv: KV): Promise<ReadonlySet<string>> {
  const raw = await kv.get(KEY)
  if (raw === null) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

/** Pin an unpinned brief, unpin a pinned one; returns the new set. */
export async function toggleBriefPin(kv: KV, id: string): Promise<ReadonlySet<string>> {
  const pinned = new Set(await loadPinnedBriefIds(kv))
  if (!pinned.delete(id)) pinned.add(id)
  await kv.set(KEY, JSON.stringify([...pinned]))
  return pinned
}
