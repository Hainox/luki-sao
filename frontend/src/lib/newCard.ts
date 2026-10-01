import type { PlaceKind } from '@/types'

/** Почему кнопку «Зафиксировать нарушение» пока нельзя нажать — причину
 *  показываем прямо под кнопкой, а не молча держим её серой. */
export function submitBlocker(opts: {
  canCreate: boolean
  photos: number
  needsDistrict: boolean
  districtId: string
  placeKind: PlaceKind | null
  territoryId: string | null
}): string | null {
  if (!opts.canCreate) return 'В журнале обходов вам не назначен район — фиксировать нарушения нельзя'
  if (opts.photos === 0) return 'Сделайте хотя бы одно фото ДО'
  if (opts.needsDistrict && !opts.districtId) return 'Выберите район'
  if (!opts.placeKind) return 'Укажите, где найден люк: ДТ или ОДХ'
  if (!opts.territoryId) return opts.placeKind === 'dt' ? 'Выберите дворовую территорию' : 'Выберите объект дорожного хозяйства'
  return null
}

/** UUID v4 для новой карточки — один на форму. randomUUID есть не во всех
 *  браузерах, которые ещё встречаются на служебных телефонах (iOS до 15.4). */
export function newCardId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
