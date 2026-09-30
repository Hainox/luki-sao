import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReviewPage from '@/pages/ReviewPage'
import { ApiError, cardsApi } from '@/lib/api'
import { cardDetail, photo, prefectureUser, renderWithProviders } from '@/test/utils'
import type { CardDetail } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    cardsApi: { ...actual.cardsApi, reviewQueue: vi.fn(), accept: vi.fn(), returnForRework: vi.fn() },
  }
})

function onReview(id: string, label: string, extra: Partial<CardDetail> = {}): CardDetail {
  return cardDetail({
    id,
    label,
    status: 'on_review',
    current_attempt: 1,
    photos: [photo('before', 0, `${id}-b`), photo('after', 1, `${id}-a`)],
    permissions: { can_add_before: false, can_add_after: true, can_review: true },
    ...extra,
  })
}

describe('ReviewPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('показывает ДО и ПОСЛЕ старейшей карточки и принимает её, открывая следующую', async () => {
    const user = userEvent.setup()
    const first = onReview('c1', 'ОЛХ-001')
    const second = onReview('c2', 'ОЛХ-002')
    vi.mocked(cardsApi.reviewQueue)
      .mockResolvedValueOnce({ items: [first, second], total: 2 })
      .mockResolvedValue({ items: [second], total: 1 })
    vi.mocked(cardsApi.accept).mockResolvedValue({ ...first, status: 'accepted' })
    renderWithProviders(<ReviewPage />, { route: '/review', user: prefectureUser })

    expect(await screen.findByRole('heading', { name: 'ОЛХ-001' })).toBeInTheDocument()
    expect(screen.getByText('В очереди: 2')).toBeInTheDocument()
    expect(screen.getByAltText('Фото ДО')).toHaveAttribute('src', '/uploads/before/c1-b.jpg')
    expect(screen.getByAltText('Фото ПОСЛЕ')).toHaveAttribute('src', '/uploads/after/c1-a.jpg')

    await user.click(screen.getByRole('button', { name: 'Принять' }))
    expect(cardsApi.accept).toHaveBeenCalledWith('c1')
    expect(await screen.findByRole('heading', { name: 'ОЛХ-002' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('В очереди: 1')).toBeInTheDocument())
  })

  it('решение уже вынес другой сотрудник префектуры — очередь обновляется', async () => {
    const user = userEvent.setup()
    const first = onReview('c1', 'ОЛХ-001')
    const second = onReview('c2', 'ОЛХ-002')
    vi.mocked(cardsApi.reviewQueue)
      .mockResolvedValueOnce({ items: [first, second], total: 2 })
      .mockResolvedValue({ items: [second], total: 1 })
    vi.mocked(cardsApi.accept).mockRejectedValue(
      new ApiError('HTTP 409', {
        response: { status: 409, data: { detail: 'Карточка не на проверке — возможно, решение уже принято' } },
      }),
    )
    renderWithProviders(<ReviewPage />, { route: '/review', user: prefectureUser })

    await user.click(await screen.findByRole('button', { name: 'Принять' }))
    expect(await screen.findByRole('heading', { name: 'ОЛХ-002' })).toBeInTheDocument()
  })

  it('вернуть на доработку можно только с комментарием', async () => {
    const user = userEvent.setup()
    const card = onReview('c1', 'ОЛХ-001')
    vi.mocked(cardsApi.reviewQueue).mockResolvedValueOnce({ items: [card], total: 1 }).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(cardsApi.returnForRework).mockResolvedValue({ ...card, status: 'returned' })
    renderWithProviders(<ReviewPage />, { route: '/review', user: prefectureUser })

    await user.click(await screen.findByRole('button', { name: 'Вернуть на доработку' }))
    const send = screen.getByRole('button', { name: 'Отправить на доработку' })
    expect(send).toBeDisabled()
    expect(screen.getByText(/Без комментария вернуть нельзя/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Что нужно исправить (обязательно)'), '   ')
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('Что нужно исправить (обязательно)'), 'Крышка не закреплена')
    expect(send).toBeEnabled()
    await user.click(send)

    expect(cardsApi.returnForRework).toHaveBeenCalledWith('c1', 'Крышка не закреплена')
    expect(await screen.findByText('Очередь пуста — все карточки проверены.')).toBeInTheDocument()
  })

  it('при повторной проверке напоминает прошлый комментарий возврата', async () => {
    const card = onReview('c1', 'ОЛХ-001', {
      current_attempt: 2,
      events: [
        {
          id: 'e2',
          kind: 'returned',
          attempt: 1,
          comment: 'Не видно крышку',
          user: { id: 'u-admin', full_name: 'Иванова Анна', login: 'prefect' },
          created_at: '2026-09-29T10:00:00Z',
        },
      ],
    })
    vi.mocked(cardsApi.reviewQueue).mockResolvedValue({ items: [card], total: 1 })
    renderWithProviders(<ReviewPage />, { route: '/review', user: prefectureUser })
    expect(await screen.findByText(/Повторная проверка — попытка 2/)).toHaveTextContent('В прошлый раз вернули: «Не видно крышку»')
  })
})
