// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SnackbarProvider, useSnackbar } from './SnackbarProvider'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Trigger() {
  const snackbar = useSnackbar()
  return (
    <button
      onClick={() =>
        snackbar.show({ message: 'Marked done', actionLabel: 'Undo', durationMs: 5000 })
      }
    >
      fire
    </button>
  )
}

function TriggerTwoActions({
  onAction,
  onSecondaryAction,
}: {
  onAction: () => void
  onSecondaryAction: () => void
}) {
  const snackbar = useSnackbar()
  return (
    <button
      onClick={() =>
        snackbar.show({
          message: 'Moved to someday',
          actionLabel: 'Undo',
          onAction,
          secondaryActionLabel: 'View',
          onSecondaryAction,
        })
      }
    >
      fire
    </button>
  )
}

describe('SnackbarProvider', () => {
  it('keeps an undo snackbar for its 5 s window, then dismisses it', () => {
    vi.useFakeTimers()
    render(
      <SnackbarProvider>
        <Trigger />
      </SnackbarProvider>,
    )
    act(() => screen.getByText('fire').click())
    expect(screen.getByText('Marked done')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    // Still visible just before the window closes…
    act(() => vi.advanceTimersByTime(4999))
    expect(screen.getByText('Marked done')).toBeInTheDocument()

    // …and gone right after.
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText('Marked done')).toBeNull()
  })

  it('renders a secondary action beside the primary; either click dismisses', () => {
    const onAction = vi.fn()
    const onSecondaryAction = vi.fn()
    render(
      <SnackbarProvider>
        <TriggerTwoActions onAction={onAction} onSecondaryAction={onSecondaryAction} />
      </SnackbarProvider>,
    )
    act(() => screen.getByText('fire').click())
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    act(() => screen.getByRole('button', { name: 'View' }).click())
    expect(onSecondaryAction).toHaveBeenCalledTimes(1)
    expect(onAction).not.toHaveBeenCalled()
    expect(screen.queryByText('Moved to someday')).toBeNull()
  })
})
