import type { PeriodKind, PeriodParams } from '@/types'

export const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: 'all', label: 'За всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'custom', label: 'Свои даты' },
]

const KINDS = new Set(PERIOD_OPTIONS.map((o) => o.value))

export function readPeriod(search: URLSearchParams): PeriodParams {
  const raw = search.get('period') as PeriodKind | null
  const period: PeriodKind = raw && KINDS.has(raw) ? raw : 'all'
  if (period !== 'custom') return { period }
  return {
    period,
    date_from: search.get('from') ?? undefined,
    date_to: search.get('to') ?? undefined,
  }
}

export function writePeriod(search: URLSearchParams, value: PeriodParams): URLSearchParams {
  const next = new URLSearchParams(search)
  next.delete('from')
  next.delete('to')
  if (value.period === 'all') next.delete('period')
  else next.set('period', value.period)
  if (value.period === 'custom') {
    if (value.date_from) next.set('from', value.date_from)
    if (value.date_to) next.set('to', value.date_to)
  }
  return next
}

/** Для «Своих дат» запрос уходит, только когда выбрана хотя бы одна дата. */
export function periodReady(value: PeriodParams): boolean {
  return value.period !== 'custom' || Boolean(value.date_from || value.date_to)
}
