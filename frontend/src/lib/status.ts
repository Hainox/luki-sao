import type { CardListItem, CardStatus } from '@/types'

export const STATUS_LABELS: Record<CardStatus, string> = {
  detected: 'Выявлено',
  on_review: 'На проверке',
  accepted: 'Принято',
  returned: 'Возвращено',
}

export const STATUS_PILL: Record<CardStatus, string> = {
  detected: 'bg-red-50 text-red-700 ring-red-200',
  on_review: 'bg-amber-50 text-amber-800 ring-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  returned: 'bg-orange-50 text-orange-700 ring-orange-200',
}

export function statusLine(card: Pick<CardListItem, 'status' | 'return_comment'>): string {
  switch (card.status) {
    case 'detected':
      return 'Нарушение зафиксировано'
    case 'on_review':
      return 'Проверка префектурой'
    case 'accepted':
      return 'Принято префектурой'
    case 'returned':
      return card.return_comment ? `Вернули: ${card.return_comment}` : 'Вернули на доработку'
  }
}
