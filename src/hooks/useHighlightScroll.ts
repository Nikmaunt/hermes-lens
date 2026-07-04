import { useEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * Search deep links: results navigate with { state: { highlightId } }.
 * Once the target list has data, scroll the matching element (marked with
 * data-item-id) into view and flash it.
 */
export function useHighlightScroll(ready: boolean): void {
  const location = useLocation()
  useEffect(() => {
    if (!ready) return
    const id = (location.state as { highlightId?: string } | null)?.highlightId
    if (typeof id !== 'string') return undefined
    const el = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`)
    if (!(el instanceof HTMLElement)) return undefined
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('highlight-flash')
    const timer = setTimeout(() => el.classList.remove('highlight-flash'), 2200)
    return () => clearTimeout(timer)
  }, [ready, location.state])
}
