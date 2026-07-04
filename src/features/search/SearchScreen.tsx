import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import { Card, EmptyState, ListSkeleton } from '@/components/primitives'
import { useData } from '@/data/DataSourceProvider'
import type { SearchResponse, SearchResultKind } from '@/schemas'

const KIND_LABELS: Record<SearchResultKind, { label: string; route: string; icon: string }> = {
  memory: { label: 'Memory', route: '/memory', icon: '◈' },
  people: { label: 'People', route: '/people', icon: '👥' },
  projects: { label: 'Projects', route: '/projects', icon: '🗂' },
  decisions: { label: 'Decisions', route: '/decisions', icon: '⚖️' },
  timeline: { label: 'Timeline', route: '/timeline', icon: '≣' },
  documents: { label: 'Documents', route: '/documents', icon: '📄' },
  inbox: { label: 'Inbox', route: '/inbox', icon: '📥' },
}

const DEBOUNCE_MS = 250

export function SearchScreen() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [failed, setFailed] = useState(false)
  const { ds } = useData()
  const navigate = useNavigate()
  const requestSeq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      if (q.length < 2) {
        setResult(null)
        setSearching(false)
        setFailed(false)
        return
      }
      setSearching(true)
      ds.search(q)
        .then((res) => {
          if (requestSeq.current !== seq) return
          setResult(res)
          setFailed(false)
        })
        .catch(() => {
          if (requestSeq.current !== seq) return
          setFailed(true)
        })
        .finally(() => {
          if (requestSeq.current === seq) setSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, ds])

  return (
    <Screen title="Search" back noSearch>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search memory, people, notes, decisions…"
        autoFocus
        type="search"
        className="w-full rounded-(--radius-card) border border-line bg-surface px-4 py-3 text-[15px] outline-none placeholder:text-faint focus:border-accent"
      />

      <div className="mt-4">
        {searching && <ListSkeleton rows={3} />}
        {!searching && failed && (
          <EmptyState icon="📡" title="Search unavailable" hint="The agent is unreachable." />
        )}
        {!searching && !failed && query.trim().length >= 2 && result !== null && result.groups.length === 0 && (
          <EmptyState icon="∅" title={`Nothing found for “${result.query}”`} />
        )}
        {!searching && query.trim().length < 2 && (
          <EmptyState
            icon="⌕"
            title="One search box for the whole brain"
            hint="Memory, people, projects, decisions, timeline, documents and inbox."
          />
        )}
        {!searching &&
          result !== null &&
          result.groups.map((group) => (
            <section key={group.kind} className="mb-5">
              <h2 className="mb-2 px-1 text-[12px] font-semibold tracking-[0.08em] text-faint uppercase">
                {KIND_LABELS[group.kind].icon} {KIND_LABELS[group.kind].label}
                <span className="tnum ml-1.5 text-faint/70">{group.results.length}</span>
              </h2>
              <div className="space-y-2">
                {group.results.map((r) => (
                  <Card
                    key={r.id}
                    onClick={() => void navigate(KIND_LABELS[group.kind].route)}
                  >
                    <div className="text-sm leading-snug font-medium">{r.title}</div>
                    {r.sensitive ? (
                      <div className="mt-1 text-[12px] leading-snug text-faint italic">
                        🔒 Sensitive — unlock in Memory
                      </div>
                    ) : (
                      <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">
                        {r.snippet}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
      </div>
    </Screen>
  )
}
