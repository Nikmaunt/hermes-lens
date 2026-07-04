import type { KV } from '@/data/kv'
import type { CardState } from '@/lib/srs'

/*
 * Review state lives on-device: the agent owns the word list, the phone owns
 * the practice history (per the "phone is a lens, plus capture" philosophy).
 */

const STATE_KEY = 'srs:polish'
const LOG_PREFIX = 'srs:reviewed:' // per-day review counters

export type SrsState = Record<string, CardState>

export async function loadSrsState(kv: KV): Promise<SrsState> {
  const raw = await kv.get(STATE_KEY)
  if (raw === null) return {}
  try {
    return JSON.parse(raw) as SrsState
  } catch {
    return {}
  }
}

export async function saveSrsState(kv: KV, state: SrsState): Promise<void> {
  await kv.set(STATE_KEY, JSON.stringify(state))
}

export async function loadReviewedToday(kv: KV, today: string): Promise<number> {
  const raw = await kv.get(LOG_PREFIX + today)
  return raw === null ? 0 : Number(raw) || 0
}

export async function bumpReviewedToday(kv: KV, today: string): Promise<number> {
  const next = (await loadReviewedToday(kv, today)) + 1
  await kv.set(LOG_PREFIX + today, String(next))
  return next
}
