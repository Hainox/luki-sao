import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddPhotoButton } from '@/components/AddPhotoButton'
import { ApiError, cardsApi } from '@/lib/api'
import { photo, renderWithProviders } from '@/test/utils'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, cardsApi: { ...actual.cardsApi, uploadPhoto: vi.fn() } }
})

const jpeg = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

describe('AddPhotoButton', () => {
  beforeEach(() => vi.clearAllMocks())

  it('после отказа 409 остальные фото пачки не отправляет', async () => {
    // Префектура вернула карточку, пока грузилось второе фото: третье, снятое
    // к той же отклонённой попытке, не должно открыть новую.
    vi.mocked(cardsApi.uploadPhoto)
      .mockResolvedValueOnce(photo('after'))
      .mockRejectedValueOnce(
        new ApiError('HTTP 409', { response: { status: 409, data: { detail: 'Пока фото загружалось…' } } }),
      )
      .mockResolvedValue(photo('after'))
    const { container } = renderWithProviders(
      <AddPhotoButton cardId="card-1" kind="after" label="Добавить фото ПОСЛЕ" remaining={5} withGallery />,
    )
    const gallery = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
    await userEvent.upload(gallery, [jpeg('1.jpg'), jpeg('2.jpg'), jpeg('3.jpg')])
    await waitFor(() => expect(cardsApi.uploadPhoto).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(cardsApi.uploadPhoto).toHaveBeenCalledTimes(2)
  })
})
