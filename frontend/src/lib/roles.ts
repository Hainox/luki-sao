import type { User } from '@/types'

/** Как на сервере (app/services/access.py): весь округ видит только
 *  префектура, сотрудник района — только свой район. Без района (инспектор
 *  или проверяющий) нет ни журнала, ни свода — в журнале обходов это
 *  незавершённая настройка аккаунта. */
export function hasNoJournal(user: User): boolean {
  return !user.is_prefecture && !user.district_id
}

export function roleLabel(user: User): string {
  if (user.is_prefecture) return 'Префектура'
  if (user.district_id) return `Район: ${user.district_name ?? '—'}`
  return 'Район не назначен'
}
