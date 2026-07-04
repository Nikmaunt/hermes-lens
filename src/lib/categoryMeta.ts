import type { EventCategory } from '@/schemas'
import {
  BotIcon,
  DiamondIcon,
  FileTextIcon,
  FlameIcon,
  FolderIcon,
  PencilIcon,
  RadioIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons'

export const CATEGORY_META: Record<EventCategory, { label: string; icon: IconComponent }> = {
  agent: { label: 'Agent', icon: BotIcon },
  memory: { label: 'Memory', icon: DiamondIcon },
  capture: { label: 'Capture', icon: PencilIcon },
  habit: { label: 'Habits', icon: FlameIcon },
  document: { label: 'Docs', icon: FileTextIcon },
  project: { label: 'Projects', icon: FolderIcon },
  people: { label: 'People', icon: UsersIcon },
  system: { label: 'System', icon: RadioIcon },
}
