import type { EventCategory } from '@/schemas'

export const CATEGORY_META: Record<EventCategory, { label: string; icon: string }> = {
  agent: { label: 'Agent', icon: '🤖' },
  memory: { label: 'Memory', icon: '◈' },
  capture: { label: 'Capture', icon: '✎' },
  habit: { label: 'Habits', icon: '🔥' },
  document: { label: 'Docs', icon: '📄' },
  project: { label: 'Projects', icon: '🗂' },
  people: { label: 'People', icon: '👥' },
  system: { label: 'System', icon: '🛰' },
}
