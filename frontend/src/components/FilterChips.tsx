import { FILTERS } from '@/lib/filters'
import type { FilterCounts, FilterGroup } from '@/types'

const DOT: Record<FilterGroup, string> = {
  all: 'bg-slate-400',
  open: 'bg-red-500',
  on_review: 'bg-amber-500',
  accepted: 'bg-emerald-500',
}

interface Props {
  value: FilterGroup
  counts?: FilterCounts
  onChange: (value: FilterGroup) => void
}

export function FilterChips({ value, counts, onChange }: Props) {
  return (
    <div role="group" aria-label="Фильтр по статусу" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      {FILTERS.map((f) => {
        const active = f.value === value
        return (
          <button
            key={f.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(f.value)}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-brand-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${active ? 'bg-white' : DOT[f.value]}`} aria-hidden />
            <span>{f.label}</span>
            <span
              data-testid={`count-${f.value}`}
              className={`rounded-full px-2 text-xs font-bold leading-6 ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}
            >
              {counts ? counts[f.value] : '…'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
