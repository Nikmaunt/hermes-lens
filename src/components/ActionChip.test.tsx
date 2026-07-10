// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionChip } from './ActionChip'
import { actionChipClass } from './actionChipStyles'

afterEach(cleanup)

describe('ActionChip', () => {
  it('guarantees a ≥44px tap target without inflating the visible pill', () => {
    render(
      <ActionChip onClick={() => {}} ariaLabel="Done: task">
        Done
      </ActionChip>,
    )
    const chip = screen.getByRole('button', { name: 'Done: task' })
    // Same contract as FilterChip: a width floor for short labels, plus an
    // invisible vertical hit-area extending the tappable height to 44px
    // (before:h-11) while the visible pill stays compact (h-8).
    expect(chip.className).toContain('min-w-11')
    expect(chip.className).toContain('before:h-11')
    expect(chip.className).toContain('h-8')
  })

  it('tones: accent uses the accent tokens, neutral and outline stay muted', () => {
    expect(actionChipClass('accent')).toContain('bg-accent')
    expect(actionChipClass('accent')).toContain('text-accent-ink')
    expect(actionChipClass('neutral')).toContain('bg-raised')
    expect(actionChipClass('outline')).toContain('border-line')
  })

  it('forwards clicks and exposes the expanded state', () => {
    const onClick = vi.fn()
    render(
      <ActionChip onClick={onClick} ariaLabel="Snooze: task" ariaExpanded={false}>
        Snooze
      </ActionChip>,
    )
    const chip = screen.getByRole('button', { name: 'Snooze: task' })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
