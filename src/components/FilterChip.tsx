/** Horizontal-scroll filter pill, shared by Timeline and Memory. */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`relative shrink-0 rounded-full px-3 py-1.5 text-center text-xs font-medium transition-colors min-w-11 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] ${
        active ? 'bg-accent text-accent-ink' : 'bg-surface border border-line text-muted'
      }`}
    >
      {children}
    </button>
  )
}
