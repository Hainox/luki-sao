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

  it('без нарушений в сводной строке нет прочерка вместо процента', async () => {
    vi.mocked(cardsApi.list).mockResolvedValue({
      ...page,
      items: [],
      total: 0,
      counts: { all: 0, open: 0, on_review: 0, accepted: 0 },
    })
    renderWithProviders(<JournalPage />)
    await waitFor(() =>
      expect(screen.getByTestId('summary-strip')).toHaveTextContent(
        'Район: Аэропорт|Выявлено: 0|Исправлено: 0|Исправлено — после приёмки префектурой.',
      ),
    )
    expect(screen.getByTestId('summary-strip').textContent).not.toMatch(/—\s*—/)
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

  it('проверяющему без района журнал округа больше не показываем', async () => {
    renderWithProviders(<JournalPage />, {
      user: { ...districtUser, role: 'reviewer', district_id: null, district_name: null, can_create_cards: false },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'В журнале обходов вам не назначен район — фотожурнал и свод недоступны. Обратитесь к администратору журнала обходов.',
    )
    expect(screen.queryByRole('link', { name: /Зафиксировать нарушение/ })).not.toBeInTheDocument()
    expect(cardsApi.list).not.toHaveBeenCalled()
    expect(districtsApi.list).not.toHaveBeenCalled()
  })

  it('инспектору без района журнал не показываем и не запрашиваем', async () => {
    renderWithProviders(<JournalPage />, {
      user: { ...districtUser, district_id: null, district_name: null, can_create_cards: false },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('В журнале обходов вам не назначен район')
    expect(screen.queryByRole('combobox', { name: 'Район' })).not.toBeInTheDocument()
    expect(cardsApi.list).not.toHaveBeenCalled()
  })
  it('«Где найдены» отбирает ДТ или ОДХ, у карточки видна метка', async () => {
    const user = userEvent.setup()
    renderWithProviders(<JournalPage />)
    const row = await screen.findByTestId('card-row')
    expect(row).toHaveTextContent('ДТУсиевича ул. 8 — у подъезда 2')
    expect(screen.getByRole('button', { name: 'Все' , pressed: true })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ОДХ' }))
    await waitFor(() => expect(cardsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ place: 'odh' })))
    expect(screen.getByRole('button', { name: 'ОДХ' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Все', pressed: false }))
    await waitFor(() => expect(cardsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ place: undefined })))
  })
})
