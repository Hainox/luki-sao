import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Download } from 'lucide-react'
import { describeError, summaryApi } from '@/lib/api'
import { NoDistrictNotice } from '@/components/NoDistrictNotice'
import { PeriodSelector } from '@/components/PeriodSelector'
import { FOOTNOTE, Kpi, PercentBar } from '@/components/SummaryParts'
import { saveBlob } from '@/lib/download'
import { formatPercent } from '@/lib/format'
import { periodReady, readPeriod, writePeriod } from '@/lib/period'
import { hasNoJournal } from '@/lib/roles'
import { notify } from '@/lib/toast'
import { DistrictSummary } from '@/pages/DistrictSummaryPage'
import { useAuthStore } from '@/stores/auth'
import type { SummaryRow } from '@/types'
import { PlaceChips } from '@/components/PlaceChips'
import { placeSuffix, readPlace, writePlace } from '@/lib/place'

/** Ссылка на подробный свод района с тем же периодом. */
function districtLink(row: SummaryRow, search: URLSearchParams): string | null {
  if (!row.district_id) return null
  const qs = search.toString()
  return `/summary/${row.district_id}${qs ? `?${qs}` : ''}`
}

function Row({ row, to, total = false }: { row: SummaryRow; to?: string | null; total?: boolean }) {
  const cell = 'px-3 py-2.5 md:px-4'
  return (
    <tr className={total ? 'bg-brand-50 font-bold' : 'border-t border-slate-100'}>
      <th scope="row" className={`${to ? 'px-3 py-0 md:px-4' : cell} whitespace-nowrap text-left ${total ? '' : 'font-semibold'}`}>
        {to ? (
          <Link to={to} className="inline-flex min-h-11 items-center gap-1 text-brand-700 hover:underline">
            {row.district_name}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          row.district_name
        )}
      </th>
      <td className={`${cell} text-center tabular-nums`}>{row.detected}</td>
      <td className={`${cell} text-center tabular-nums text-emerald-700`}>{row.fixed}</td>
      <td className={`${cell} text-center tabular-nums text-amber-700`}>{row.on_review}</td>
      <td className={`${cell} min-w-44`}>
        <PercentBar fixed={row.fixed} detected={row.detected} name={row.district_name} />
      </td>
    </tr>
  )
}

/** На телефоне широкая таблица из пяти колонок не помещается — там те же
 *  данные карточками по району. */
function MobileRow({ row, to, total = false }: { row: SummaryRow; to?: string | null; total?: boolean }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 font-bold">
        {row.district_name}
        {to && <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />}
      </div>
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
      <PercentBar fixed={row.fixed} detected={row.detected} name={row.district_name} />
    </>
  )
  const box = 'flex flex-col gap-1.5 px-4 py-3'
  return (
    <li className={total ? 'bg-brand-50' : ''}>
      {to ? (
        <Link to={to} className={`${box} hover:bg-slate-50 active:bg-slate-100`}>
          {body}
        </Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  )
}

/** Таблица по всем районам — только у префектуры; строка района открывает
 *  его подробный свод. */
function OkrugSummary() {
  const [search, setSearch] = useSearchParams()
  const period = readPeriod(search)
  const place = readPlace(search)
  const params = { ...period, place: place === 'all' ? undefined : place }
  const [downloading, setDownloading] = useState(false)
  const query = useQuery({
    queryKey: ['summary', params],
    queryFn: () => summaryApi.get(params),
    enabled: periodReady(period),
  })
  const data = query.data
  const total = data?.total

  const download = async () => {
    setDownloading(true)
    try {
      const blob = await summaryApi.xlsx(params)
      const suffix = data && data.period.kind !== 'all' ? ` ${data.period.label}` : ''
      saveBlob(blob, `Свод по люкам САО${placeSuffix(place)}${suffix}.xlsx`)
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
      <PlaceChips value={place} onChange={(p) => setSearch(writePlace(search, p), { replace: true })} />

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
            <MobileRow key={row.district_id ?? row.district_name} row={row} to={districtLink(row, search)} />
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
                  <Row key={row.district_id ?? row.district_name} row={row} to={districtLink(row, search)} />
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
      {data && data.rows.length > 0 && (
        <p className="text-sm text-slate-600">Нажмите на район, чтобы открыть подробный свод по нему.</p>
      )}
      <p className="text-sm text-slate-500">{FOOTNOTE}</p>
    </div>
  )
}

/** Свод по всем районам видит только префектура, сотрудник района — сразу
 *  подробный свод своего района (так же решает и сервер). */
export default function SummaryPage() {
  const user = useAuthStore((s) => s.user)!
  if (hasNoJournal(user)) return <NoDistrictNotice title="Свод по люкам" />
  if (!user.is_prefecture) return <DistrictSummary />
  return <OkrugSummary />
}
