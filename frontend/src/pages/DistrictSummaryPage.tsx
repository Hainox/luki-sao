import { useState } from 'react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Download } from 'lucide-react'
import { describeError, summaryApi } from '@/lib/api'
import { PeriodSelector } from '@/components/PeriodSelector'
import { StatusPill } from '@/components/StatusPill'
import { FOOTNOTE, Kpi, PercentBar } from '@/components/SummaryParts'
import { saveBlob } from '@/lib/download'
import { formatDate, formatDays } from '@/lib/format'
import { periodReady, readPeriod, writePeriod } from '@/lib/period'
import { notify } from '@/lib/toast'
import { useAuthStore } from '@/stores/auth'
import type { DistrictSummary as DistrictSummaryData, DynamicsBucket, OldestOpenCard } from '@/types'
import { PlaceBadge } from '@/components/PlaceBadge'
import { PlaceChips } from '@/components/PlaceChips'
import { placeSuffix, readPlace, writePlace } from '@/lib/place'

export const PERIOD_NOTE =
  'Показатели и динамика — по карточкам, выявленным в выбранном периоде. «Дольше всех ждут исправления» — все неисправленные карточки района, независимо от периода.'

function DynamicsSection({ data }: { data: DistrictSummaryData }) {
  const unit = data.dynamics_unit === 'day' ? 'День' : 'Месяц'
  const rows = data.dynamics
  return (
    <section className="card overflow-hidden" aria-labelledby="dynamics-title">
      <h2 id="dynamics-title" className="px-4 pb-2 pt-4 text-lg font-bold md:px-5">
        Динамика
      </h2>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-slate-600 md:px-5">Карточек пока нет.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden" aria-label="Динамика">
            {rows.map((b) => (
              <DynamicsItem key={b.date_from} bucket={b} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[15px]">
              <thead className="bg-slate-50 text-sm text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">{unit}</th>
                  <th scope="col" className="px-4 py-3 text-center">Выявлено</th>
                  <th scope="col" className="px-4 py-3 text-center">Исправлено</th>
                  <th scope="col" className="px-4 py-3 text-left">% исправления</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.date_from} className="border-t border-slate-100">
                    <th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">
                      {b.label}
                    </th>
                    <td className="px-4 py-2.5 text-center tabular-nums">{b.detected}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums text-emerald-700">{b.accepted}</td>
                    <td className="min-w-44 px-4 py-2.5">
                      <PercentBar fixed={b.accepted} detected={b.detected} name={b.label} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function DynamicsItem({ bucket: b }: { bucket: DynamicsBucket }) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="font-bold">{b.label}</div>
      <div className="flex flex-wrap gap-x-3 text-sm text-slate-600">
        <span>
          Выявлено: <b className="text-slate-900">{b.detected}</b>
        </span>
        <span>
          Исправлено: <b className="text-emerald-700">{b.accepted}</b>
        </span>
      </div>
      <PercentBar fixed={b.accepted} detected={b.detected} name={b.label} />
    </li>
  )
}

function OldestOpenSection({ cards }: { cards: OldestOpenCard[] }) {
  return (
    <section className="card overflow-hidden" aria-labelledby="oldest-title">
      <h2 id="oldest-title" className="px-4 pb-2 pt-4 text-lg font-bold md:px-5">
        Дольше всех ждут исправления
      </h2>
      {cards.length === 0 ? (
        <p className="px-4 pb-4 text-slate-600 md:px-5">Неисправленных карточек нет.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100" aria-label="Дольше всех ждут исправления">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                to={`/cards/${c.id}`}
                className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-slate-50 active:bg-slate-100 md:px-5"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold tracking-tight text-slate-900">{c.label}</span>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="flex items-start gap-1.5 font-semibold text-slate-800">
                    <PlaceBadge kind={c.place_kind} />
                    <span>{c.address}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums text-red-700">{c.age_days} дн.</div>
                  <div className="text-xs text-slate-500">с {formatDate(c.created_at)}</div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Подробный свод по одному району. Без districtId — район сотрудника
 *  (сервер сам подставит его район и не даст открыть чужой). */
export function DistrictSummary({ districtId, showBack = false }: { districtId?: string; showBack?: boolean }) {
  const user = useAuthStore((s) => s.user)!
  const [search, setSearch] = useSearchParams()
  const period = readPeriod(search)
  const place = readPlace(search)
  const params = { ...period, district_id: districtId, place: place === 'all' ? undefined : place }
  const [downloading, setDownloading] = useState(false)
  const query = useQuery({
    queryKey: ['summary', 'district', districtId ?? 'own', period, place],
    queryFn: () => summaryApi.district(params),
    enabled: periodReady(period),
  })
  const data = query.data
  const t = data?.totals
  const name = data?.district.name ?? (districtId ? null : user.district_name)
  const qs = search.toString()

  const download = async () => {
    setDownloading(true)
    try {
      const blob = await summaryApi.districtXlsx(params)
      const suffix = data && data.period.kind !== 'all' ? ` ${data.period.label}` : ''
      saveBlob(blob, `Свод по люкам — ${name ?? 'район'}${placeSuffix(place)}${suffix}.xlsx`)
    } catch (err) {
      notify.error(describeError(err, 'Не удалось скачать Excel'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {showBack && (
        <Link
          to={`/summary${qs ? `?${qs}` : ''}`}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 font-semibold text-brand-600 hover:underline"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
          Все районы
        </Link>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Свод по району: {name ?? '…'}</h1>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="district-kpis">
        <Kpi label="Выявлено" value={t?.detected ?? '…'} tone="text-slate-900" />
        <Kpi label="Исправлено" value={t?.accepted ?? '…'} tone="text-emerald-700" />
        <Kpi label="На проверке" value={t?.on_review ?? '…'} tone="text-amber-700" />
        <Kpi label="Не исправлено" value={t?.open ?? '…'} tone="text-red-700" />
        <Kpi label="% исправления" value={t?.percent_text ?? '…'} tone="text-brand-600" />
        <Kpi label="Возвратов на доработку" value={t?.returns_count ?? '…'} tone="text-orange-700" />
        <Kpi
          label="Среднее время до приёмки"
          value={t ? formatDays(t.avg_days_to_accept) : '…'}
          tone="text-slate-900"
          className="col-span-2"
        />
      </div>

      {!periodReady(period) && <div className="card p-6 text-center text-slate-600">Выберите хотя бы одну дату периода.</div>}
      {query.isError && (
        <div role="alert" className="card p-6 text-red-800">
          {describeError(query.error, 'Не удалось загрузить свод')}
        </div>
      )}

      {/* Сначала то, что ждёт работы района: динамика за месяц — это 30
          строк, и на телефоне список давних нарушений уезжал бы далеко вниз. */}
      {data && <OldestOpenSection cards={data.oldest_open} />}
      {data && <DynamicsSection data={data} />}

      <div className="flex flex-col gap-1 text-sm text-slate-500">
        <p>{FOOTNOTE}</p>
        <p>{PERIOD_NOTE}</p>
      </div>
    </div>
  )
}

/** /summary/:districtId — подробный свод района для префектуры. Остальные
 *  открывают свой район на /summary: чужой район им недоступен. */
export default function DistrictSummaryPage() {
  const { districtId = '' } = useParams()
  const user = useAuthStore((s) => s.user)!
  const location = useLocation()
  if (!user.is_prefecture) return <Navigate to={{ pathname: '/summary', search: location.search }} replace />
  return <DistrictSummary key={districtId} districtId={districtId} showBack />
}
