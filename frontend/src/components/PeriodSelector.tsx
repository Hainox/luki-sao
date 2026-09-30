import { CalendarDays } from 'lucide-react'
import { PERIOD_OPTIONS } from '@/lib/period'
import { formatIsoDate } from '@/lib/format'
import type { PeriodInfo, PeriodParams } from '@/types'

interface Props {
  value: PeriodParams
  onChange: (value: PeriodParams) => void
  /** Точные границы периода с сервера — показываем, что именно посчитано. */
  resolved?: PeriodInfo
}

export function PeriodSelector({ value, onChange, resolved }: Props) {
  const rangeText =
    resolved && resolved.date_from && resolved.date_to
      ? resolved.date_from === resolved.date_to
        ? formatIsoDate(resolved.date_from)
        : `${formatIsoDate(resolved.date_from)} — ${formatIsoDate(resolved.date_to)}`
      : null

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Период" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {PERIOD_OPTIONS.map((o) => {
          const active = o.value === value.period
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ period: o.value, date_from: value.date_from, date_to: value.date_to })}
              className={`min-h-11 shrink-0 rounded-xl px-3.5 text-sm font-semibold transition-colors ${
                active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {value.period === 'custom' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm font-semibold text-slate-700">
            с
            <input
              type="date"
              className="field mt-1 w-44"
              value={value.date_from ?? ''}
              max={value.date_to}
              onChange={(e) => onChange({ ...value, date_from: e.target.value || undefined })}
            />
          </label>
          <label className="flex flex-col text-sm font-semibold text-slate-700">
            по
            <input
              type="date"
              className="field mt-1 w-44"
              value={value.date_to ?? ''}
              min={value.date_from}
              onChange={(e) => onChange({ ...value, date_to: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
      {rangeText && (
        <div className="flex items-center gap-1.5 text-sm text-slate-500">
          <CalendarDays className="h-4 w-4" aria-hidden />
          {rangeText} (по московскому времени)
        </div>
      )}
    </div>
  )
}
