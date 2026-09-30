import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { describeError, summaryApi } from '@/lib/api'
import { PeriodSelector } from '@/components/PeriodSelector'
import { fixedPercent, formatPercent } from '@/lib/format'
import { periodReady, readPeriod, writePeriod } from '@/lib/period'
import { notify } from '@/lib/toast'
import type { SummaryRow } from '@/types'

export const FOOTNOTE =
  'Исправлено — принято администратором префектуры. Процент = исправлено / выявлено × 100. При отсутствии нарушений — прочерк.'

function Kpi({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <div className="text-sm font-semibold text-slate-500">{label}</div>
      <div className={`text-3xl font-bold tracking-tight ${tone}`}>{value}</div>
    </div>
  )
}

function PercentBar({ row }: { row: SummaryRow }) {
  const value = fixedPercent(row.fixed, row.detected)
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2.5 min-w-20 flex-1 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label={`Исправлено ${row.district_name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? 0}
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(value ?? 0, 100)}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right font-semibold tabular-nums">{formatPercent(row.fixed, row.detected)}</span>
    </div>
  )
}

function Row({ row, total = false }: { row: SummaryRow; total?: boolean }) {
  const cell = 'px-3 py-2.5 md:px-4'
  return (
    <tr className={total ? 'bg-brand-50 font-bold' : 'border-t border-slate-100'}>
      <th scope="row" className={`${cell} whitespace-nowrap text-left ${total ? '' : 'font-semibold'}`}>
        {row.district_name}
      </th>
      <td className={`${cell} text-center tabular-nums`}>{row.detected}</td>
      <td className={`${cell} text-center tabular-nums text-emerald-700`}>{row.fixed}</td>
      <td className={`${cell} text-center tabular-nums text-amber-700`}>{row.on_review}</td>
      <td className={`${cell} min-w-44`}>
        <PercentBar row={row} />
      </td>
    </tr>
  )
}

/** На телефоне широкая таблица из пяти колонок не помещается — там те же
 *  данные карточками по району. */
function MobileRow({ row, total = false }: { row: SummaryRow; total?: boolean }) {
  return (
    <li className={`flex flex-col gap-1.5 px-4 py-3 ${total ? 'bg-brand-50' : ''}`}>
      <div className="font-bold">{row.district_name}</div>
      <div className="flex flex-wrap gap-x-3 text-sm text-slate-600">
        <span>
          Выявлено: <b className="text-slate-900">{row.detected}</b>
        </span>
        <span>
          Исправлено: <b className="text-emerald-700">{row.fixed}</b>
        </span>
        <span>
          На проверке: <b className="text-amber-700">{row.on_review}</b>
        </span>
      </div>
      <PercentBar row={row} />
    </li>
  )
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function SummaryPage() {
  const [search, setSearch] = useSearchParams()
  const period = readPeriod(search)
  const [downloading, setDownloading] = useState(false)
  const query = useQuery({
    queryKey: ['summary', period],
    queryFn: () => summaryApi.get(period),
    enabled: periodReady(period),
  })
  const data = query.data
  const total = data?.total

  const download = async () => {
    setDownloading(true)
    try {
      const blob = await summaryApi.xlsx(period)
      const suffix = data && data.period.kind !== 'all' ? ` ${data.period.label}` : ''
      saveBlob(blob, `Свод по люкам САО${suffix}.xlsx`)
    } catch (err) {
      notify.error(describeError(err, 'Не удалось скачать Excel'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Свод по люкам</h1>
        <button type="button" className="btn-primary" onClick={download} disabled={downloading || !periodReady(period)}>
          <Download className="h-5 w-5" aria-hidden />
          {downloading ? 'Готовим файл…' : 'Скачать Excel'}
        </button>
      </div>

      <PeriodSelector
        value={period}
        resolved={data?.period}
        onChange={(p) => setSearch(writePeriod(search, p), { replace: true })}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Выявлено" value={total?.detected ?? '…'} tone="text-slate-900" />
        <Kpi label="Исправлено" value={total?.fixed ?? '…'} tone="text-emerald-700" />
        <Kpi label="На проверке" value={total?.on_review ?? '…'} tone="text-amber-700" />
        <Kpi label="Исправлено %" value={total ? formatPercent(total.fixed, total.detected) : '…'} tone="text-brand-600" />
      </div>

      {!periodReady(period) && <div className="card p-6 text-center text-slate-600">Выберите хотя бы одну дату периода.</div>}
      {query.isError && (
        <div role="alert" className="card p-6 text-red-800">
          {describeError(query.error, 'Не удалось загрузить свод')}
        </div>
      )}

      {data && (
        <ul className="card divide-y divide-slate-100 overflow-hidden md:hidden" aria-label="Свод по районам">
          {data.rows.map((row) => (
            <MobileRow key={row.district_id ?? row.district_name} row={row} />
          ))}
          <MobileRow row={data.total} total />
        </ul>
      )}
      {data && (
        <div className="card hidden overflow-hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[15px]">
              <thead className="bg-slate-50 text-sm text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-3 text-left md:px-4">Район</th>
                  <th scope="col" className="px-3 py-3 text-center md:px-4">Выявлено (неудовлетворительные ОЛХ)</th>
                  <th scope="col" className="px-3 py-3 text-center md:px-4">Исправлено</th>
                  <th scope="col" className="px-3 py-3 text-center md:px-4">На проверке</th>
                  <th scope="col" className="px-3 py-3 text-left md:px-4">% исправления</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <Row key={row.district_id ?? row.district_name} row={row} />
                ))}
              </tbody>
              <tfoot>
                <Row row={data.total} total />
              </tfoot>
            </table>
          </div>
          {data.rows.length === 0 && (
            <p className="p-4 text-sm text-slate-600">
              Список районов появится после первого входа администратора префектуры.
            </p>
          )}
        </div>
      )}
      <p className="text-sm text-slate-500">{FOOTNOTE}</p>
    </div>
  )
}
