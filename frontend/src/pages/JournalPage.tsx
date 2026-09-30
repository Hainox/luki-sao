import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { cardsApi, describeError, districtsApi } from '@/lib/api'
import { CardRow } from '@/components/CardRow'
import { DistrictSelect } from '@/components/DistrictSelect'
import { FilterChips } from '@/components/FilterChips'
import { FILTERS } from '@/lib/filters'
import { PeriodSelector } from '@/components/PeriodSelector'
import { formatPercent } from '@/lib/format'
import { periodReady, readPeriod, writePeriod } from '@/lib/period'
import { useAuthStore } from '@/stores/auth'
import type { FilterGroup, FilterCounts, User } from '@/types'

const PAGE_SIZE = 20
const FILTER_VALUES = new Set(FILTERS.map((f) => f.value))

function SummaryStrip({ districtName, counts }: { districtName: string; counts?: FilterCounts }) {
  const detected = counts?.all ?? 0
  const fixed = counts?.accepted ?? 0
  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[15px] sm:gap-x-3" data-testid="summary-strip">
      <span>
        Район: <b>{districtName}</b>
      </span>
      <span className="hidden text-slate-300 sm:inline" aria-hidden>
        |
      </span>
      <span>
        Выявлено: <b>{counts ? detected : '…'}</b>
      </span>
      <span className="hidden text-slate-300 sm:inline" aria-hidden>
        |
      </span>
      <span>
        Исправлено: <b className="text-emerald-700">{counts ? fixed : '…'}</b>
      </span>
      <span className="hidden text-slate-300 sm:inline" aria-hidden>
        |
      </span>
      <span>
        <b>{counts ? formatPercent(fixed, detected) : '…'}</b>
        <span className="text-slate-500"> — Исправлено — после приёмки префектурой.</span>
      </span>
    </div>
  )
}

function CreateButton({ user }: { user: User }) {
  if (user.can_create_cards) {
    return (
      <Link to="/cards/new" className="btn-primary w-full md:w-auto">
        <Plus className="h-5 w-5" aria-hidden />
        Зафиксировать нарушение
      </Link>
    )
  }
  return (
    <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
      В журнале обходов вам не назначен район — фиксировать нарушения нельзя, доступен только просмотр.
    </div>
  )
}

export default function JournalPage() {
  const user = useAuthStore((s) => s.user)!
  const [search, setSearch] = useSearchParams()
  const pinnedDistrict = !user.is_prefecture && user.district_id ? user.district_id : null
  const districtId = pinnedDistrict ?? search.get('district') ?? ''
  const rawFilter = search.get('filter') as FilterGroup | null
  const filter: FilterGroup = rawFilter && FILTER_VALUES.has(rawFilter) ? rawFilter : 'all'
  const period = readPeriod(search)

  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(search)
    mutate(next)
    setSearch(next, { replace: true })
  }

  const { data: districts = [] } = useQuery({
    queryKey: ['districts'],
    queryFn: districtsApi.list,
    enabled: !pinnedDistrict,
    staleTime: 10 * 60_000,
  })

  const params = { ...period, district_id: districtId || undefined, filter, page_size: PAGE_SIZE }
  const query = useInfiniteQuery({
    queryKey: ['cards', params],
    queryFn: ({ pageParam }) => cardsApi.list({ ...params, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: periodReady(period),
  })

  const first = query.data?.pages[0]
  const items = query.data?.pages.flatMap((p) => p.items) ?? []
  const districtName = pinnedDistrict
    ? (user.district_name ?? '—')
    : (districts.find((d) => d.id === districtId)?.name ?? 'Все районы')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Фотожурнал</h1>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <DistrictSelect
            user={user}
            value={districtId}
            onChange={(id) => update((n) => (id ? n.set('district', id) : n.delete('district')))}
          />
          <CreateButton user={user} />
        </div>
      </div>

      <SummaryStrip districtName={districtName} counts={first?.counts} />

      <div className="flex flex-col gap-3">
        <FilterChips
          value={filter}
          counts={first?.counts}
          onChange={(f) => update((n) => (f === 'all' ? n.delete('filter') : n.set('filter', f)))}
        />
        <PeriodSelector
          value={period}
          resolved={first?.period}
          onChange={(p) => setSearch(writePeriod(search, p), { replace: true })}
        />
      </div>

      {!periodReady(period) && (
        <div className="card p-6 text-center text-slate-600">Выберите хотя бы одну дату периода.</div>
      )}
      {query.isError && (
        <div role="alert" className="card border-red-200 p-4 text-red-800">
          {describeError(query.error, 'Не удалось загрузить журнал')}
          <button type="button" className="btn-secondary ml-3" onClick={() => query.refetch()}>
            Повторить
          </button>
        </div>
      )}
      {query.isPending && periodReady(period) && <div className="card p-6 text-center text-slate-500">Загрузка…</div>}
      {query.isSuccess && items.length === 0 && (
        <div className="card p-8 text-center text-slate-600">
          {filter === 'all' ? 'За выбранный период нарушений не зафиксировано.' : 'В этой группе карточек нет.'}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {items.map((card) => (
          <CardRow key={card.id} card={card} />
        ))}
      </div>

      {query.hasNextPage && (
        <button
          type="button"
          className="btn-secondary self-center"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </div>
  )
}
