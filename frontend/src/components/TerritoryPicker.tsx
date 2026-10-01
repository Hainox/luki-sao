import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, MapPin, Search } from 'lucide-react'
import { describeError, territoriesApi } from '@/lib/api'
import { PlaceBadge } from '@/components/PlaceBadge'
import { OWNER_LABELS, PLACE_LABELS, PLACE_TITLES, formatDistance, matchesQuery } from '@/lib/place'
import type { NearbyTerritory, PlaceKind, Territory } from '@/types'

const MATCH_LIMIT = 8
const NEARBY_SHOWN = 5

const SEARCH_HINT: Record<PlaceKind, string> = {
  dt: 'Например: Усиевича 8',
  odh: 'Например: Ленинградский проспект',
}

interface Props {
  /** Район, в котором фиксируют нарушение; '' — ещё не выбран (у префектуры). */
  districtId: string
  districtReady: boolean
  kind: PlaceKind | null
  onKindChange: (kind: PlaceKind) => void
  value: Territory | null
  onChange: (value: Territory | null) => void
  coords: { lat: number; lon: number } | null
  disabled: boolean
}

function OptionButton({ t, extra, showKind, onPick, disabled }: {
  t: Territory
  extra?: string
  showKind?: boolean
  onPick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
    >
      {showKind && <PlaceBadge kind={t.kind} />}
      <span className="min-w-0 flex-1 text-[15px] text-slate-800">{t.name}</span>
      {extra && <span className="shrink-0 text-sm font-semibold text-slate-500">{extra}</span>}
    </button>
  )
}

/** Где найден люк: ДТ или ОДХ и конкретный объект реестра АСУ ОДС —
 *  поиском по названию или из подсказки «Рядом с вами» по геолокации. */
export function TerritoryPicker({
  districtId, districtReady, kind, onKindChange, value, onChange, coords, disabled,
}: Props) {
  const [query, setQuery] = useState('')

  const list = useQuery({
    queryKey: ['territories', districtId],
    queryFn: () => territoriesApi.list(districtId),
    enabled: districtReady,
    staleTime: 30 * 60_000,
  })
  const nearby = useQuery({
    queryKey: ['territories-nearby', districtId, coords?.lat, coords?.lon],
    queryFn: () => territoriesApi.nearby(coords!.lat, coords!.lon, districtId),
    enabled: districtReady && coords !== null,
    staleTime: 5 * 60_000,
  })

  const matches = useMemo(
    () => (list.data ?? []).filter((t) => t.kind === kind && matchesQuery(t.name, query)),
    [list.data, kind, query],
  )
  const near: NearbyTerritory[] = (nearby.data ?? []).filter((t) => !kind || t.kind === kind).slice(0, NEARBY_SHOWN)

  const pick = (t: Territory) => {
    if (t.kind !== kind) onKindChange(t.kind)
    onChange(t)
    setQuery('')
  }

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="label">Где найден люк</legend>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="ДТ или ОДХ">
        {(['dt', 'odh'] as PlaceKind[]).map((k) => {
          const active = kind === k
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (k === kind) return
                onKindChange(k)
                onChange(null)
              }}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl px-2 py-1.5 text-center transition-colors ${
                active ? 'bg-brand-600 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="text-base font-bold">{PLACE_LABELS[k]}</span>
              <span className={`text-xs leading-tight ${active ? 'text-white/85' : 'text-slate-500'}`}>{PLACE_TITLES[k]}</span>
            </button>
          )
        })}
      </div>

      {!districtReady ? (
        <p className="text-sm text-slate-600">Сначала выберите район — появится список его ДТ и ОДХ.</p>
      ) : value ? (
        <div className="flex flex-col gap-1.5 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200" data-testid="picked-territory">
          <div className="flex items-start gap-2">
            <PlaceBadge kind={value.kind} />
            <span className="font-semibold text-slate-900">{value.name}</span>
          </div>
          {value.owner && (
            <div className="text-sm text-slate-600">
              {OWNER_LABELS[value.kind]}: {value.owner}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary min-h-11" onClick={() => onChange(null)}>
              Изменить объект
            </button>
            {value.passport_url && (
              <a
                href={value.passport_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
              >
                Паспорт в реестре
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </div>
        </div>
      ) : (
        <>
          {near.length > 0 && (
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
              <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                <MapPin className="h-4 w-4" aria-hidden />
                Рядом с вами
              </div>
              <ul className="divide-y divide-slate-100" aria-label="Рядом с вами">
                {near.map((t) => (
                  <li key={t.id}>
                    <OptionButton t={t} extra={formatDistance(t.distance_m)} showKind={!kind} onPick={() => pick(t)} disabled={disabled} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {coords && nearby.isSuccess && near.length === 0 && (
            <p className="text-sm text-slate-600">
              {kind ? `В 300 м от вас ${PLACE_LABELS[kind]} района не нашлось` : 'В 300 м от вас объектов района не нашлось'} —
              найдите объект по названию.
            </p>
          )}

          {kind ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="territory-search" className="text-sm font-semibold text-slate-700">
                {kind === 'dt' ? 'Найдите дворовую территорию' : 'Найдите объект дорожного хозяйства'}
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  id="territory-search"
                  className="field pl-10"
                  value={query}
                  autoComplete="off"
                  placeholder={SEARCH_HINT[kind]}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {list.isPending && <p className="text-sm text-slate-500">Загружаем список…</p>}
              {list.isError && (
                <p className="text-sm text-red-700" role="alert">
                  {describeError(list.error, 'Не удалось загрузить список ДТ и ОДХ')}
                </p>
              )}
              {list.isSuccess && (
                <>
                  <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200" aria-label="Найденные объекты">
                    {matches.slice(0, MATCH_LIMIT).map((t) => (
                      <li key={t.id}>
                        <OptionButton t={t} onPick={() => pick(t)} disabled={disabled} />
                      </li>
                    ))}
                    {matches.length === 0 && (
                      <li className="px-3 py-3 text-sm text-slate-600">Ничего не нашлось — проверьте название.</li>
                    )}
                  </ul>
                  {matches.length > MATCH_LIMIT && (
                    <p className="text-sm text-slate-500">
                      Показаны {MATCH_LIMIT} из {matches.length} — уточните название.
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            near.length === 0 && <p className="text-sm text-slate-600">Выберите, где найден люк: ДТ или ОДХ.</p>
          )}
        </>
      )}
    </fieldset>
  )
}
