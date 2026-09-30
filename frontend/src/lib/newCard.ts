/** Почему кнопку «Зафиксировать нарушение» пока нельзя нажать — причину
 *  показываем прямо под кнопкой, а не молча держим её серой. */
export function submitBlocker(opts: {
  canCreate: boolean
  photos: number
  address: string
  needsDistrict: boolean
  districtId: string
}): string | null {
  if (!opts.canCreate) return 'В журнале обходов вам не назначен район — фиксировать нарушения нельзя'
  if (opts.photos === 0) return 'Сделайте хотя бы одно фото ДО'
  if (opts.address.trim().length < 3) return 'Укажите адрес'
  if (opts.needsDistrict && !opts.districtId) return 'Выберите район'
  return null
}
