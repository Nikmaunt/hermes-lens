import type { KV } from '@/data/kv'

/** Key of the token inside Keystore-backed secure storage. */
const TOKEN_KEY = 'api-token'
/** The plaintext Preferences entry the token historically lived inside. */
const LEGACY_SETTINGS_KEY = 'settings'

function readLegacyToken(rawSettings: string | null): string | null {
  if (rawSettings === null) return null
  try {
    const parsed = JSON.parse(rawSettings) as Record<string, unknown>
    return typeof parsed.apiToken === 'string' && parsed.apiToken !== '' ? parsed.apiToken : null
  } catch {
    return null
  }
}

/** Remove the plaintext apiToken field from the stored settings JSON. */
async function scrubLegacyToken(plain: KV): Promise<void> {
  const raw = await plain.get(LEGACY_SETTINGS_KEY)
  if (raw === null) return
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!('apiToken' in parsed)) return
    delete parsed.apiToken
    await plain.set(LEGACY_SETTINGS_KEY, JSON.stringify(parsed))
  } catch {
    // Unparseable settings fall back to defaults in loadSettings; nothing to scrub.
  }
}

/**
 * One-time move of the bearer token out of the plaintext settings JSON (F8)
 * into Keystore-backed storage. Idempotent and fail-open:
 * - the plaintext copy is deleted only after the secure write has been
 *   verified by reading the value back;
 * - if secure storage already holds a token, it wins and the legacy copy is
 *   just scrubbed;
 * - on any secure-storage failure the legacy copy is left in place and keeps
 *   working through loadApiToken's fallback, so a broken Keystore can never
 *   lock the user out or silently lose the token — worst case Settings asks
 *   for the token again.
 */
export async function migrateApiToken(plain: KV, secure: KV): Promise<void> {
  const legacy = readLegacyToken(await plain.get(LEGACY_SETTINGS_KEY))
  if (legacy === null) return
  try {
    const existing = await secure.get(TOKEN_KEY)
    if (existing === null || existing === '') {
      await secure.set(TOKEN_KEY, legacy)
    }
    const verified = await secure.get(TOKEN_KEY)
    if (verified !== null && verified !== '') await scrubLegacyToken(plain)
  } catch {
    // Fail open: keep the legacy plaintext copy until secure storage works.
  }
}

/** Read the token: migrate if needed, secure storage first, legacy fallback. */
export async function loadApiToken(plain: KV, secure: KV): Promise<string> {
  await migrateApiToken(plain, secure)
  try {
    const value = await secure.get(TOKEN_KEY)
    if (value !== null && value !== '') return value
  } catch {
    // Secure read failed — fall back to a not-yet-migrated legacy copy.
  }
  return readLegacyToken(await plain.get(LEGACY_SETTINGS_KEY)) ?? ''
}

/**
 * Persist a new token. Throws when secure storage rejects the write so the
 * caller can keep its in-memory value and surface the failure; the legacy
 * plaintext copy is scrubbed only after the secure write succeeded.
 */
export async function saveApiToken(plain: KV, secure: KV, token: string): Promise<void> {
  if (token === '') await secure.remove(TOKEN_KEY)
  else await secure.set(TOKEN_KEY, token)
  await scrubLegacyToken(plain)
}
