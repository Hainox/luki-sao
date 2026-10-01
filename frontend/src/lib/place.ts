import type { PlaceFilter, PlaceKind } from '@/types'

export const PLACE_LABELS: Record<PlaceKind, string> = { dt: 'ДТ', odh: 'ОДХ' }
export const PLACE_TITLES: Record<PlaceKind, string> = {
  dt: 'Дворовая территория',
  odh: 'Объект дорожного хозяйства',
}

/** Кто отвечает за объект по реестру: у ДТ — балансодержатель, у ОДХ — заказчик. */
export const OWNER_LABELS: Record<PlaceKind, string> = { dt: 'Балансодержатель', odh: 'Заказчик' }

export const PLACE_FILTERS: { value: PlaceFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'dt', label: 'ДТ' },
  { value: 'odh', label: 'ОДХ' },
]

const VALUES = new Set(PLACE_FILTERS.map((p) => p.value))

export function readPlace(search: URLSearchParams): PlaceFilter {
  const raw = search.get('place') as PlaceFilter | null
  return raw && VALUES.has(raw) ? raw : 'all'
}

export function writePlace(search: URLSearchParams, value: PlaceFilter): URLSearchParams {
  const next = new URLSearchParams(search)
  if (value === 'all') next.delete('place')
  else next.set('place', value)
  return next
}

/** Подпись к имени файла Excel — как у сервера в Content-Disposition. */
export function placeSuffix(place: PlaceFilter): string {
  return place === 'all' ? '' : ` (${PLACE_LABELS[place]})`
}

/** Для поиска объекта: регистр, «ё» и знаки препинания не важны. */
export function searchKey(text: string): string {
  return text
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Все слова запроса должны встретиться в названии: «усиевича 8» найдёт
 *  «Усиевича ул. 8, 10». */
export function matchesQuery(name: string, query: string): boolean {
  const words = searchKey(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const key = searchKey(name)
  return words.every((w) => key.includes(w))
}

export function formatDistance(meters: number): string {
  if (meters === 0) return 'вы здесь'
  return `${meters} м`
}
