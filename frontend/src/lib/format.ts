const MSK = 'Europe/Moscow'

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: MSK, day: '2-digit', month: '2-digit', year: 'numeric' })

// Даты везде показываем по Москве, а не по часовому поясу телефона:
// у части сотрудников он выставлен неверно, а свод считается по МСК.
export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso))
}

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

/** YYYY-MM-DD → ДД.ММ.ГГГГ без участия часовых поясов. */
export function formatIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

export function cardLabel(number: number): string {
  return `ОЛХ-${String(number).padStart(3, '0')}`
}

/** Процент исправления: одна десятичная с запятой, «,0» отбрасывается,
 *  прочерк — если нарушений не выявлено. Округление — половина вверх,
 *  как на сервере и в Excel (66,666… → 66,7; 31,25 → 31,3). */
export function fixedPercent(fixed: number, detected: number): number | null {
  if (detected <= 0) return null
  return Math.round((fixed * 1000) / detected) / 10
}

export function formatPercent(fixed: number, detected: number): string {
  const value = fixedPercent(fixed, detected)
  if (value === null) return '—'
  const text = value.toFixed(1).replace('.', ',')
  return `${text.endsWith(',0') ? text.slice(0, -2) : text}%`
}

/** Среднее время до приёмки: «2,5 дн.», «3 дн.»; прочерк — если принятых нет. */
export function formatDays(value: number | null): string {
  if (value === null) return '—'
  const text = value.toFixed(1).replace('.', ',')
  return `${text.endsWith(',0') ? text.slice(0, -2) : text} дн.`
}
