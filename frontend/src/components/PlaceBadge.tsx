import { PLACE_LABELS, PLACE_TITLES } from '@/lib/place'
import type { PlaceKind } from '@/types'

const TONE: Record<PlaceKind, string> = {
  dt: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  odh: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
}

export function PlaceBadge({ kind }: { kind: PlaceKind | null }) {
  if (!kind) return null
  return (
    <span
      title={PLACE_TITLES[kind]}
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 text-xs font-bold leading-5 ring-1 ${TONE[kind]}`}
    >
      {PLACE_LABELS[kind]}
    </span>
  )
}
