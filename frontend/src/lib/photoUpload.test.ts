import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { photoProblem, uploadWithRetry } from '@/lib/photoUpload'

function file(name: string, type: string, size = 1000): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('photoProblem', () => {
  it('пропускает фото с камеры, включая HEIC без типа (iPhone)', () => {
    expect(photoProblem(file('IMG_0001.jpg', 'image/jpeg'))).toBeNull()
    expect(photoProblem(file('IMG_0002.HEIC', ''))).toBeNull()
    expect(photoProblem(file('screen.webp', 'image/webp'))).toBeNull()
  })

  it('отклоняет не-фото, пустые и слишком большие файлы', () => {
    expect(photoProblem(file('doc.pdf', 'application/pdf'))).toMatch(/только фотографии/)
    expect(photoProblem(file('evil.svg', 'image/svg+xml'))).toMatch(/только фотографии/)
    expect(photoProblem(file('empty.jpg', 'image/jpeg', 0))).toMatch(/пустой/)
    expect(photoProblem(file('huge.jpg', 'image/jpeg', 21 * 1024 * 1024))).toMatch(/больше 20 МБ/)
  })
})

describe('uploadWithRetry', () => {
  it('повторяет при сбое связи и в итоге отправляет', async () => {
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError('network', { code: 'ERR_NETWORK' }))
      .mockRejectedValueOnce(new ApiError('HTTP 502', { response: { status: 502, data: null } }))
      .mockResolvedValueOnce('ok')
    await expect(uploadWithRetry(send, [0, 0])).resolves.toBe('ok')
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('сдаётся после исчерпания попыток', async () => {
    const send = vi.fn<() => Promise<string>>().mockRejectedValue(new ApiError('network', { code: 'ERR_NETWORK' }))
    await expect(uploadWithRetry(send, [0, 0])).rejects.toBeInstanceOf(ApiError)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('не повторяет отказ сервера по существу (карточка уже принята)', async () => {
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new ApiError('HTTP 409', { response: { status: 409, data: { detail: 'Карточка уже принята префектурой' } } }))
    await expect(uploadWithRetry(send, [0, 0])).rejects.toBeInstanceOf(ApiError)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
