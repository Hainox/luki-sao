import type { User } from '@/types'

/** Как на сервере (app/services/access.py): весь округ видят префектура и
 *  проверяющий без района, а инспектор без района не видит журнал вовсе —
 *  в журнале обходов это незавершённая настройка аккаунта. */
export function hasNoJournal(user: User): boolean {
  return !user.is_prefecture && !user.district_id && user.role !== 'reviewer'
}

export function roleLabel(user: User): string {
  if (user.is_prefecture) return 'Префектура'
  if (user.district_id) return `Район: ${user.district_name ?? '—'}`
  if (user.role === 'reviewer') return 'Округ, только просмотр'
  return 'Район не назначен'
}
