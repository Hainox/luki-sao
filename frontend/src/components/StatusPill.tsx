import { STATUS_LABELS, STATUS_PILL } from '@/lib/status'
import type { CardStatus } from '@/types'

export function StatusPill({ status, className = '' }: { status: CardStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${STATUS_PILL[status]} ${className}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  )
}
