/** Момент истечения входа (мс) из поля exp токена; null — если токен не
 *  похож на JWT. Подпись не проверяем: это только подсказка для интерфейса,
 *  решает всё равно сервер. */
export function tokenExpiresAt(token: string): number | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')))
    return typeof payload?.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

// Часы служебного телефона бывают сбиты на часы. По часам телефона окно
// «вход скоро закончится» открывалось бы сразу после нового входа и снова и
// снова — поэтому срок сверяем с часами сервера (заголовок Date ответов API).
let clockOffsetMs = 0

export function rememberServerTime(dateHeader: string | null) {
  const server = dateHeader ? Date.parse(dateHeader) : NaN
  if (!Number.isNaN(server)) clockOffsetMs = server - Date.now()
}

export function serverNow(): number {
  return Date.now() + clockOffsetMs
}
