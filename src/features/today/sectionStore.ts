import type { KV } from '@/data/kv'

/*
 * Collapse/expand choices for the Today sections, client-only like the
 * briefs read-set. Only user-touched sections are stored: a section's
 * default stays soft until the first header tap, then the stored choice
 * wins on every later boot.
 */

export type TodaySectionId = 'followups' | 'deadlines' | 'someday' | 'agent'

/** id → expanded, present only for sections the user has toggled. */
export type SectionChoices = Partial<Record<TodaySectionId, boolean>>

const KEY = 'today:sections'

const SECTION_IDS: readonly TodaySectionId[] = ['followups', 'deadlines', 'someday', 'agent']

export async function loadSectionChoices(kv: KV): Promise<SectionChoices> {
  const raw = await kv.get(KEY)
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const choices: SectionChoices = {}
    for (const id of SECTION_IDS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (typeof value === 'boolean') choices[id] = value
    }
    return choices
  } catch {
    return {}
  }
}

export async function saveSectionChoices(kv: KV, choices: SectionChoices): Promise<void> {
  await kv.set(KEY, JSON.stringify(choices))
}
