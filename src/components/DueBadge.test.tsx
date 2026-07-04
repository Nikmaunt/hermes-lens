// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DueBadge } from './DueBadge'
import { dueBadgeLabel, dueToneFor } from '@/lib/dates'

const NOW = new Date(2026, 6, 4) // 4 Jul 2026, local

describe('dueBadgeLabel', () => {
  it('formats future, present and past dates as short single-line labels', () => {
    expect(dueBadgeLabel('2026-07-04', NOW)).toBe('today')
    expect(dueBadgeLabel('2026-07-05', NOW)).toBe('tomorrow')
    expect(dueBadgeLabel('2026-07-09', NOW)).toBe('in 5d')
  })

  it('uses the short "late" form for overdue instead of "overdue"', () => {
    expect(dueBadgeLabel('2026-07-03', NOW)).toBe('1d late')
    expect(dueBadgeLabel('2026-06-22', NOW)).toBe('12d late')
  })
})

describe('dueToneFor', () => {
  it('derives overdue / today / future tones from the date', () => {
    expect(dueToneFor('2026-07-01', NOW)).toBe('overdue')
    expect(dueToneFor('2026-07-04', NOW)).toBe('warn')
    expect(dueToneFor('2026-08-01', NOW)).toBe('neutral')
  })
})

describe('DueBadge', () => {
  it('renders a single-line, fixed-height, vertically centered pill', () => {
    render(<DueBadge date="2026-07-03" now={NOW} />)
    const pill = screen.getByText('1d late')
    expect(pill.className).toContain('whitespace-nowrap')
    expect(pill.className).toContain('h-5.5')
    expect(pill.className).toContain('items-center')
    expect(pill.className).toContain('min-w-11')
    expect(pill.className).toContain('tnum')
  })

  it('uses the desaturated overdue palette for late dates by default', () => {
    render(<DueBadge date="2026-07-01" now={NOW} />)
    expect(screen.getByText('3d late').className).toContain('text-overdue')
  })

  it('honours an explicit tone override and an optional prefix', () => {
    render(<DueBadge date="2026-07-06" tone="warn" prefix="renews" now={NOW} />)
    expect(screen.getByText('renews in 2d').className).toContain('text-warn')
  })
})
