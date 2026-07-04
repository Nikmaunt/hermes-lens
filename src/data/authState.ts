/**
 * Tracks whether the agent is currently rejecting our token (F3). Set by
 * ApiDataSource on 401/403, cleared by any successful response (or when the
 * data source is switched). The Shell renders a persistent banner that deep
 * links to Settings while this is true — an auth failure must never be
 * mistaken for "offline, showing stale cache".
 */
let authFailed = false
const listeners = new Set<(failed: boolean) => void>()

export function reportAuthFailure(): void {
  if (authFailed) return
  authFailed = true
  for (const fn of listeners) fn(true)
}

export function clearAuthFailure(): void {
  if (!authFailed) return
  authFailed = false
  for (const fn of listeners) fn(false)
}

export function isAuthFailed(): boolean {
  return authFailed
}

export function onAuthFailureChange(fn: (failed: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
