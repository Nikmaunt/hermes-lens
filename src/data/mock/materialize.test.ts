import { describe, expect, it } from 'vitest'
import { materialize } from './materialize'

const NOW = new Date(2026, 6, 4, 12, 0, 0) // 4 Jul 2026 local

describe('materialize', () => {
  it('replaces date tokens relative to now', () => {
    expect(materialize('@d-3', NOW)).toBe('2026-07-01')
    expect(materialize('@d+0', NOW)).toBe('2026-07-04')
    expect(materialize('@d+14', NOW)).toBe('2026-07-18')
  })

  it('replaces timestamp tokens with local offset', () => {
    const result = materialize('@t-2@09:15', NOW)
    expect(result).toMatch(/^2026-07-02T09:15:00[+-]\d{2}:\d{2}$/)
  })

  it('crosses month boundaries correctly', () => {
    expect(materialize('@d-5', NOW)).toBe('2026-06-29')
  })

  it('walks nested structures and leaves other values alone', () => {
    const tree = {
      date: '@d-1',
      nested: [{ at: '@t-0@08:00', n: 42, ok: true }],
      nothing: null,
    }
    const out = materialize(tree, NOW)
    expect(out.date).toBe('2026-07-03')
    expect(out.nested[0]?.at).toContain('2026-07-04T08:00:00')
    expect(out.nested[0]?.n).toBe(42)
    expect(out.nested[0]?.ok).toBe(true)
    expect(out.nothing).toBeNull()
  })

  it('renders tokens inside prose as human-readable dates', () => {
    expect(materialize('registration opens @d+33, started @d-19', NOW)).toBe(
      'registration opens 6 Aug 2026, started 15 Jun 2026',
    )
  })
})
