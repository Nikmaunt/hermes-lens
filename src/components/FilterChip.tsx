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
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? 'bg-accent text-accent-ink' : 'bg-surface border border-line text-muted'
      }`}
    >
      {children}
    </button>
  )
}
