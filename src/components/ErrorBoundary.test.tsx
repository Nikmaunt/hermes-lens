// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

// React logs the caught error (twice under StrictMode) — keep the run quiet.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function Bomb(): never {
  throw new Error('render exploded: cannot read x of undefined')
}

describe('root ErrorBoundary', () => {
  it('renders children while nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>healthy app</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('healthy app')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a throwing child renders the fallback with the error text, not a white screen', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    // The actual message is visible — the owner debugs a sideloaded build by eye.
    expect(alert).toHaveTextContent('render exploded: cannot read x of undefined')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('the Reload button reloads the page', async () => {
    const reload = vi.fn()
    // jsdom's location.reload is not implemented — swap the whole location in.
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    })
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })
})
