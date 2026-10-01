import { fixedPercent, formatPercent } from '@/lib/format'

export const FOOTNOTE =
  'Исправлено — принято администратором префектуры. Процент = исправлено / выявлено × 100. При отсутствии нарушений — прочерк.'

export function Kpi({
  label,
  value,
  tone,
  className = '',
}: {
  label: string
  value: string | number
  tone: string
  className?: string
}) {
  return (
    <div className={`card flex flex-col gap-1 p-4 ${className}`}>
      <div className="text-sm font-semibold text-slate-500">{label}</div>
      <div className={`text-3xl font-bold tracking-tight ${tone}`}>{value}</div>
    </div>
  )
}

export function PercentBar({ fixed, detected, name }: { fixed: number; detected: number; name: string }) {
  const value = fixedPercent(fixed, detected)
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2.5 min-w-20 flex-1 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label={`Исправлено ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? 0}
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(value ?? 0, 100)}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right font-semibold tabular-nums">{formatPercent(fixed, detected)}</span>
    </div>
  )
}
