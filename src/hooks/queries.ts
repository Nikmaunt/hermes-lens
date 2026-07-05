import { useData } from '@/data/DataSourceProvider'
import type { EventCategory } from '@/schemas'
import { useCachedQuery } from './useCachedQuery'

export function useStatus() {
  const { ds } = useData()
  return useCachedQuery('status', () => ds.getStatus())
}

export function useToday() {
  const { ds } = useData()
  return useCachedQuery('today', () => ds.getToday())
}

export function useTimeline(category?: EventCategory) {
  const { ds } = useData()
  const key = category ? `timeline:${category}` : 'timeline'
  return useCachedQuery(key, () => ds.getTimeline(category ? { category } : undefined))
}

export function useMemoryItems() {
  const { ds } = useData()
  return useCachedQuery('memory', () => ds.getMemory())
}

export function useProjects() {
  const { ds } = useData()
  return useCachedQuery('projects', () => ds.getProjects())
}

export function usePeople() {
  const { ds } = useData()
  return useCachedQuery('people', () => ds.getPeople())
}

export function useDocuments() {
  const { ds } = useData()
  return useCachedQuery('documents', () => ds.getDocuments())
}

export function useDecisions(projectId?: string) {
  const { ds } = useData()
  const key = projectId ? `decisions:${projectId}` : 'decisions'
  return useCachedQuery(key, () => ds.getDecisions(projectId))
}

export function useHabits() {
  const { ds } = useData()
  return useCachedQuery('habits', () => ds.getHabits())
}

export function usePolishWords() {
  const { ds } = useData()
  return useCachedQuery('polish-words', () => ds.getPolishWords())
}

export function useInbox() {
  const { ds } = useData()
  return useCachedQuery('inbox', () => ds.getInbox())
}

export function useReminders() {
  const { ds } = useData()
  return useCachedQuery('reminders', () => ds.getReminders())
}

export function useBriefs() {
  const { ds } = useData()
  return useCachedQuery('briefs', () => ds.getBriefs())
}

export function useBrief(id: string) {
  const { ds } = useData()
  return useCachedQuery(`brief:${id}`, () => ds.getBrief(id))
}
