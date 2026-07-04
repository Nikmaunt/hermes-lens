/**
 * In-memory ring buffer of schema-validation failures (F4). Deliberately not
 * persisted: entries can quote payload fragments, and the debug view only
 * needs "what broke just now". Shown in Settings → Debug.
 */
export interface ValidationLogEntry {
  at: string
  /** Endpoint path the payload came from, e.g. "/api/today". */
  path: string
  /** Human-readable zod issues, e.g. "items[3].dueAt: Invalid ISO datetime". */
  issues: string[]
}

const MAX_ENTRIES = 20

const entries: ValidationLogEntry[] = []
const listeners = new Set<() => void>()

export function recordValidationIssues(path: string, issues: string[]): void {
  entries.unshift({ at: new Date().toISOString(), path, issues })
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
  for (const fn of listeners) fn()
}

export function getValidationLog(): readonly ValidationLogEntry[] {
  return entries
}

export function onValidationLogChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
