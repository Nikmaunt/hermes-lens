import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronRightIcon, KeyIcon } from '@/components/icons'
import { isAuthFailed, onAuthFailureChange } from '@/data/authState'

/**
 * Persistent banner while the agent rejects the token (F3). Sits above the
 * bottom nav on every screen and deep-links to Settings; clears itself as
 * soon as any request succeeds again.
 */
export function AuthBanner() {
  const navigate = useNavigate()
  const [failed, setFailed] = useState(isAuthFailed)

  useEffect(() => onAuthFailureChange(setFailed), [])

  if (!failed) return null
  return (
    <button
      onClick={() => void navigate('/settings')}
      className="bg-danger-dim text-danger fixed inset-x-0 z-30 mx-auto flex w-full max-w-lg items-center gap-2 px-4 py-2.5 text-left text-xs font-medium backdrop-blur-md"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 64px)' }}
    >
      <KeyIcon size={14} className="shrink-0" />
      <span className="flex-1">Agent rejected the token — tap to fix it in Settings</span>
      <ChevronRightIcon size={14} className="shrink-0" />
    </button>
  )
}
