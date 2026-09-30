import type { User } from '@/types'

export function roleLabel(user: User): string {
  if (user.is_prefecture) return 'Префектура'
  if (user.district_name) return `Район: ${user.district_name}`
  return 'Округ, только просмотр'
}
