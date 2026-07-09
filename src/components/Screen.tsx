import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, SearchIcon } from '@/components/icons'
import { useSettings } from '@/settings/SettingsProvider'

interface ScreenProps {
  title: string
  children: ReactNode
  /** Back arrow instead of the app mark (for stacked detail screens). */
  back?: boolean
  actions?: ReactNode
  /** Hide the search shortcut (e.g. on the Search screen itself). */
  noSearch?: boolean
  /**
   * Fill exactly the visible viewport above the fixed BottomNav instead of
   * growing with content, so the page itself never scrolls — for screens that
   * own their own scroller (e.g. /chat). `svh` (not `dvh`) never overestimates
   * when the system bars are shown, so no phantom scrollbar appears. The
   * child is responsible for its own overflow.
   */
  fill?: boolean
}

/** Page wrapper: sticky top bar + content column with safe-area padding. */
export function Screen({
  title,
  children,
  back = false,
  actions,
  noSearch = false,
  fill = false,
}: ScreenProps) {
  const navigate = useNavigate()
  const { settings } = useSettings()
  return (
    <div
      className={`mx-auto flex w-full max-w-lg flex-col ${fill ? '' : 'min-h-full'}`}
      // 3.5rem = the BottomNav's h-14; its safe-area padding is added on top.
      style={fill ? { height: 'calc(100svh - 3.5rem - env(safe-area-inset-bottom))' } : undefined}
    >
      <header
        className="bg-bg/85 sticky top-0 z-20 flex items-center gap-3 px-4 pb-3 backdrop-blur-md"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)' }}
      >
        {back && (
          <button
            aria-label="Back"
            onClick={() => void navigate(-1)}
            className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-raised"
          >
            <ArrowLeftIcon size={18} />
          </button>
        )}
        <h1 className="flex-1 truncate text-headline font-semibold tracking-tight">
          {title}
          {settings.source === 'mock' && (
            <span className="ml-2 inline-block rounded-full bg-warn-dim px-2 py-0.5 align-middle text-micro font-semibold tracking-wide text-warn uppercase">
              Demo
            </span>
          )}
        </h1>
        {actions}
        {!noSearch && (
          <button
            aria-label="Search"
            onClick={() => void navigate('/search')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-raised"
          >
            <SearchIcon size={18} />
          </button>
        )}
      </header>
      <main
        className={
          fill
            ? 'animate-fade-up flex min-h-0 flex-1 flex-col px-4'
            : 'animate-fade-up flex-1 px-4 pb-6'
        }
      >
        {children}
      </main>
    </div>
  )
}
