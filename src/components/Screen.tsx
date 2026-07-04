import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'

interface ScreenProps {
  title: string
  children: ReactNode
  /** Back arrow instead of the app mark (for stacked detail screens). */
  back?: boolean
  actions?: ReactNode
  /** Hide the search shortcut (e.g. on the Search screen itself). */
  noSearch?: boolean
}

/** Page wrapper: sticky top bar + content column with safe-area padding. */
export function Screen({ title, children, back = false, actions, noSearch = false }: ScreenProps) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col">
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
            ←
          </button>
        )}
        <h1 className="flex-1 truncate text-[19px] font-semibold tracking-tight">{title}</h1>
        {actions}
        {!noSearch && (
          <button
            aria-label="Search"
            onClick={() => void navigate('/search')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted active:bg-raised"
          >
            ⌕
          </button>
        )}
      </header>
      <main className="animate-fade-up flex-1 px-4 pb-6">{children}</main>
    </div>
  )
}
