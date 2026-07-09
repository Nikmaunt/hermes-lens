// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilterChip } from './FilterChip'

afterEach(cleanup)

describe('FilterChip', () => {
  it('guarantees a ≥44px tap target without inflating the visible pill', () => {
    render(
      <FilterChip active={false} onClick={() => {}}>
        All
      </FilterChip>,
    )
    const chip = screen.getByRole('button', { name: 'All' })
    // A width floor for short labels, plus an invisible vertical hit-area that
    // extends the tappable height to 44px (h-11) without changing the pill's
    // own flow height — so chip rows keep their layout.
    expect(chip.className).toContain('min-w-11')
    expect(chip.className).toContain('before:h-11')
  })

  it('reflects the active state and forwards clicks', () => {
    const onClick = vi.fn()
    render(
      <FilterChip active onClick={onClick}>
        Docs
      </FilterChip>,
    )
    const chip = screen.getByRole('button', { name: 'Docs' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
