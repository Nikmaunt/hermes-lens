import { NavLink } from 'react-router'

const TABS = [
  { to: '/', label: 'Today', icon: '◉' },
  { to: '/timeline', label: 'Timeline', icon: '≣' },
  { to: '/capture', label: 'Capture', icon: '+' },
  { to: '/memory', label: 'Memory', icon: '◈' },
  { to: '/more', label: 'More', icon: '⋯' },
] as const

export function BottomNav() {
  return (
    <nav
      className="bg-bg/92 fixed inset-x-0 bottom-0 z-30 border-t border-line backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 text-micro font-medium transition-colors ${
                isActive ? 'text-accent' : 'text-faint'
              }`
            }
          >
            {tab.to === '/capture' ? (
              <span className="bg-accent text-accent-ink -mt-4 flex h-11 w-11 items-center justify-center rounded-full text-xl font-semibold shadow-lg">
                {tab.icon}
              </span>
            ) : (
              <>
                <span className="text-title-lg leading-none">{tab.icon}</span>
                <span>{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
