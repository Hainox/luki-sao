import { PLACE_FILTERS } from '@/lib/place'
import type { PlaceFilter } from '@/types'

/** «Где найдены: Все / ДТ / ОДХ» — отбор карточек в журнале и сводах. */
export function PlaceChips({ value, onChange }: { value: PlaceFilter; onChange: (value: PlaceFilter) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-slate-600" id="place-filter-label">
        Где найдены:
      </span>
      <div role="group" aria-labelledby="place-filter-label" className="flex gap-1.5">
        {PLACE_FILTERS.map((p) => {
          const active = p.value === value
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(p.value)}
              className={`min-h-11 rounded-xl px-3.5 text-sm font-semibold transition-colors ${
                active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
