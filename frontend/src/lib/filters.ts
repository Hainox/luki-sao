import type { FilterGroup } from '@/types'

export const FILTERS: { value: FilterGroup; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'open', label: 'Выявлено (Не исправлено)' },
  { value: 'on_review', label: 'На проверке' },
  { value: 'accepted', label: 'Исправлено (Принято)' },
]
