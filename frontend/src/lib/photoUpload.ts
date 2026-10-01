import { isRetryable, retryAfterRelogin } from '@/lib/api'

export const MAX_PHOTOS = 5
export const MAX_PHOTO_SIZE_MB = 20
const MAX_PHOTO_SIZE_BYTES = MAX_PHOTO_SIZE_MB * 1024 * 1024
// Синхронно с ALLOWED_EXTENSIONS на сервере (app/services/photos.py).
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']
export const PHOTO_ACCEPT = 'image/*,.heic,.heif'

function extensionOf(file: File): string {
  const parts = file.name.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

/** Причина, по которой файл не подойдёт, или null. Проверяем расширение,
 *  а не только file.type: iPhone в Safari/PWA часто отдаёт для HEIC пустой
 *  тип, и валидное фото с камеры отклонялось бы. */
export function photoProblem(file: File): string | null {
  const ext = extensionOf(file)
  const typeOk = file.type === '' || file.type.startsWith('image/')
  if (!typeOk || (ext && !ALLOWED_EXTENSIONS.includes(ext))) {
    return `«${file.name}»: подойдут только фотографии`
  }
  if (!ext && !file.type.startsWith('image/')) {
    return `«${file.name}»: не похоже на фотографию`
  }
  if (file.size === 0) return `«${file.name}»: файл пустой`
  if (file.size > MAX_PHOTO_SIZE_BYTES) return `«${file.name}»: больше ${MAX_PHOTO_SIZE_MB} МБ`
  return null
}

export const RETRY_DELAYS_MS = [1500, 3000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Автоповтор отправки фото, как в журнале обходов: связь в поле «плавает»,
 *  большинство сбоев проходит само за пару секунд. Ошибки, которые
 *  повтором не лечатся (403/409/400 — нет прав, карточка уже принята,
 *  не тот файл), пробрасываются сразу. Истёкший вход (401) — не сбой:
 *  отправка ждёт повторного входа и продолжается сама (retryAfterRelogin). */
export async function uploadWithRetry<T>(
  send: () => Promise<T>,
  delays: number[] = RETRY_DELAYS_MS,
  beforeResume?: () => Promise<void>,
): Promise<T> {
  return retryAfterRelogin(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await send()
      } catch (err) {
        if (attempt >= delays.length || !isRetryable(err)) throw err
        await sleep(delays[attempt])
      }
    }
  }, beforeResume)
}
