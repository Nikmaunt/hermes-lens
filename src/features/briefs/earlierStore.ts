import type { KV } from '@/data/kv'

/*
 * Collapse state for the Earlier group on the Briefs screen, client-only
 * like the read-set and the pin-set. Default collapsed: past briefs are
 * archive, not news — the group opens only on an explicit tap, and that
 * choice survives restarts.
 */

const KEY = 'briefs:earlier-expanded'

export async function loadEarlierExpanded(kv: KV): Promise<boolean> {
  return (await kv.get(KEY)) === 'true'
}

export async function saveEarlierExpanded(kv: KV, expanded: boolean): Promise<void> {
  await kv.set(KEY, expanded ? 'true' : 'false')
}
