import { useState } from 'react'
import { useSettings } from '@/settings/SettingsProvider'

/**
 * First-run choice (F1): connect the real agent or explicitly enter Demo
 * mode. Rendered instead of the app until the user decides — bundled sample
 * data is never shown as if it were real.
 */
export function FirstRunScreen() {
  const { update, updateApiToken } = useSettings()
  const [connecting, setConnecting] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')

  const connect = () => {
    const url = baseUrl.trim()
    if (url === '') return
    updateApiToken(token.trim())
    update({ source: 'api', apiBaseUrl: url, configured: true })
  }

  const useDemo = () => {
    update({ source: 'mock', configured: true })
  }

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center gap-8 px-6 pb-10"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="border-accent/40 text-accent flex h-16 w-16 items-center justify-center rounded-2xl border text-3xl">
          ◈
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Hermes Lens</h1>
        <p className="max-w-70 text-sm text-muted">
          A window into your self-hosted Hermes agent — memory, projects, capture. Private by
          design: it talks only to your agent, over your tailnet.
        </p>
      </div>

      {connecting ? (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Base URL (Tailscale)</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://hermes-vps:8787"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              className="w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Bearer token</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="paste the static token"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
            <span className="mt-1 block text-caption text-faint">
              Stored in Android Keystore-backed encrypted storage. Never logged, never leaves the
              tailnet.
            </span>
          </label>
          <button
            onClick={connect}
            disabled={baseUrl.trim() === ''}
            className="bg-accent text-accent-ink w-full rounded-(--radius-card) py-3.5 text-body font-semibold transition-opacity active:opacity-80 disabled:opacity-30"
          >
            Connect
          </button>
          <button
            onClick={() => setConnecting(false)}
            className="w-full py-2 text-center text-sm text-faint active:opacity-70"
          >
            Back
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => setConnecting(true)}
            className="bg-accent text-accent-ink w-full rounded-(--radius-card) py-3.5 text-body font-semibold transition-opacity active:opacity-80"
          >
            Connect your agent
          </button>
          <button
            onClick={useDemo}
            className="w-full rounded-(--radius-card) border border-line bg-surface py-3.5 text-body font-medium text-muted active:bg-raised"
          >
            Try demo mode
          </button>
          <p className="text-center text-caption text-faint">
            Demo mode shows bundled sample data — nothing real, nothing synced. You can connect
            the agent later in Settings.
          </p>
        </div>
      )}
    </div>
  )
}
