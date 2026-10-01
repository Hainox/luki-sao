import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import CardDetailPage from '@/pages/CardDetailPage'
import { cardsApi } from '@/lib/api'
import { cardDetail, renderWithProviders } from '@/test/utils'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, cardsApi: { ...actual.cardsApi, get: vi.fn() } }
})

describe('CardDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cardsApi.get).mockResolvedValue(cardDetail())
  })

  it('рендерит секции фото ДО, ПОСЛЕ и истории', async () => {
    const { container } = renderWithProviders(<CardDetailPage />, { route: '/cards/card-1' })
    expect(await screen.findByText('ОЛХ-001')).toBeInTheDocument()
    expect(container.textContent).toContain('Фото ДО')
    expect(container.textContent).toContain('Фото ПОСЛЕ')
    expect(container.textContent).toContain('История')
    expect(container.textContent).toContain('ДТУсиевича ул. 8 — у подъезда 2')
    expect(container.textContent).toContain('Балансодержатель: Жилищник Аэропорт')
    expect(screen.getByRole('link', { name: 'Паспорт в реестре' })).toHaveAttribute(
      'href',
      'https://reestr-ogh.mos.ru/ogh/132296151000038',
    )
  })

  it('невалидная карточка — ошибка без падения', async () => {
    const { ApiError } = await import('@/lib/api')
    vi.mocked(cardsApi.get).mockRejectedValueOnce(
      new ApiError('HTTP 404', { response: { status: 404, data: { detail: 'Карточка не найдена' } } }),
    )
    renderWithProviders(<CardDetailPage />, { route: '/cards/card-1' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Карточка не найдена')
  })
})
