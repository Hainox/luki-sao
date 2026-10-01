import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { districtsApi } from '@/lib/api'
import type { User } from '@/types'

interface Props {
  user: User
  value: string
  onChange: (districtId: string) => void
}

/** Сотрудник района закреплён за своим районом — ему показываем его район
 *  без выбора; префектуре — выбор с «Все районы». */
export function DistrictSelect({ user, value, onChange }: Props) {
  const pinned = !user.is_prefecture && user.district_id
  const { data: districts = [] } = useQuery({
    queryKey: ['districts'],
    queryFn: districtsApi.list,
    enabled: !pinned,
    staleTime: 10 * 60_000,
  })

  if (pinned) {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3.5 text-[15px] font-semibold text-slate-800 ring-1 ring-slate-200">
        <MapPin className="h-4 w-4 text-brand-600" aria-hidden />
        Район: {user.district_name ?? '—'}
      </div>
    )
  }

  return (
    <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white pl-3.5 text-[15px] font-semibold text-slate-800 ring-1 ring-slate-200">
      <MapPin className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
      <span className="shrink-0">Район:</span>
      <select
        aria-label="Район"
        className="min-h-11 min-w-0 flex-1 rounded-xl bg-transparent pr-3 font-semibold outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Все районы</option>
        {districts.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  )
}
