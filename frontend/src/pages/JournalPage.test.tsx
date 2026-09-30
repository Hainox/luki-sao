import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import JournalPage from '@/pages/JournalPage'
import { cardsApi, districtsApi } from '@/lib/api'
import { districtUser, listItem, prefectureUser, renderWithProviders } from '@/test/utils'
import type { CardList } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    cardsApi: { ...actual.cardsApi, list: vi.fn() },
    districtsApi: { list: vi.fn() },
  }
})

const page: CardList = {
  items: [listItem()],
  total: 1,
  page: 1,
  page_size: 20,
  counts: { all: 12, open: 4, on_review: 1, accepted: 7 },
  period: { kind: 'all', date_from: null, date_to: null, label: 'За всё время' },
}

describe('JournalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cardsApi.list).mockResolvedValue(page)
    vi.mocked(districtsApi.list).mockResolvedValue([
      { id: 'd-aero', name: 'Аэропорт' },
      { id: 'd-sokol', name: 'Сокол' },
    ])
  })

  it('сотрудник района видит свой район, сводную строку и счётчики фильтров', async () => {
    renderWithProviders(<JournalPage />)
    expect(await screen.findByText('ОЛХ-001')).toBeInTheDocument()
    expect(cardsApi.list).toHaveBeenCalledWith(expect.objectContaining({ district_id: 'd-aero', filter: 'all', period: 'all', page: 1 }))
    expect(screen.queryByRole('combobox', { name: 'Район' })).not.toBeInTheDocument()
    expect(screen.getByTestId('summary-strip')).toHaveTextContent(
      'Район: Аэропорт|Выявлено: 12|Исправлено: 7|58,3% — Исправлено — после приёмки префектурой.',
    )
    expect(screen.getByTestId('count-open')).toHaveTextContent('4')
    expect(screen.getByRole('link', { name: /Зафиксировать нарушение/ })).toHaveAttribute('href', '/cards/new')
  })

  it('фильтр и период уходят в запрос', async () => {
    const user = userEvent.setup()
    renderWithProviders(<JournalPage />)
    await screen.findByText('ОЛХ-001')
    await user.click(screen.getByRole('button', { name: /Выявлено \(Не исправлено\)/ }))
    await waitFor(() => expect(cardsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'open' })))
    await user.click(screen.getByRole('button', { name: 'Месяц' }))
    await waitFor(() =>
      expect(cardsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'open', period: 'month' })),
    )
  })

  it('префектура выбирает район из списка, по умолчанию — все районы', async () => {
    const user = userEvent.setup()
    renderWithProviders(<JournalPage />, { user: prefectureUser })
    await screen.findByText('ОЛХ-001')
    expect(cardsApi.list).toHaveBeenCalledWith(expect.objectContaining({ district_id: undefined }))
    expect(screen.getByTestId('summary-strip')).toHaveTextContent('Район: Все районы')
    await screen.findByRole('option', { name: 'Сокол' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Район' }), 'd-sokol')
    await waitFor(() => expect(cardsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ district_id: 'd-sokol' })))
    expect(screen.getByTestId('summary-strip')).toHaveTextContent('Район: Сокол')
  })

  it('без района в журнале обходов — только просмотр', async () => {
    renderWithProviders(<JournalPage />, {
      user: { ...districtUser, role: 'reviewer', district_id: null, district_name: null, can_create_cards: false },
    })
    await screen.findByText('ОЛХ-001')
    expect(screen.queryByRole('link', { name: /Зафиксировать нарушение/ })).not.toBeInTheDocument()
    expect(screen.getByText(/доступен только просмотр/)).toBeInTheDocument()
  })

  it('инспектору без района журнал не показываем и не запрашиваем', async () => {
    renderWithProviders(<JournalPage />, {
      user: { ...districtUser, district_id: null, district_name: null, can_create_cards: false },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('В журнале обходов вам не назначен район')
    expect(screen.queryByRole('combobox', { name: 'Район' })).not.toBeInTheDocument()
    expect(cardsApi.list).not.toHaveBeenCalled()
  })
})
