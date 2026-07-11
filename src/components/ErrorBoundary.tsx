import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Root-level render-crash net: a runtime throw during render used to unmount
 * everything into a white screen. The fallback names the error and offers a
 * reload — deliberately minimal (plain markup, no telemetry, no providers)
 * so it can never crash itself.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-5 px-8 text-center"
      >
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted">
            The app hit an unexpected error and couldn't recover on its own.
          </p>
        </div>
        <p className="max-w-full font-mono text-xs break-all text-faint">
          {error.message === '' ? String(error) : error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-accent text-accent-ink rounded-full px-8 py-3 text-sm font-semibold active:opacity-80"
        >
          Reload
        </button>
      </div>
    )
  }
}
