import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SummaryPage from '@/pages/SummaryPage'
import { summaryApi } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import type { Summary, SummaryRow } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, summaryApi: { get: vi.fn(), xlsx: vi.fn() } }
})

function row(name: string, detected: number, fixed: number, onReview: number): SummaryRow {
  return { district_id: name, district_name: name, detected, fixed, on_review: onReview, percent: null, percent_label: '' }
}

const summary: Summary = {
  period: { kind: 'all', date_from: null, date_to: null, label: 'За всё время' },
  rows: [row('Аэропорт', 3, 2, 1), row('Коптево', 0, 0, 0), row('Сокол', 10, 7, 0)],
  total: row('Итого по САО', 13, 9, 1),
}

describe('SummaryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(summaryApi.get).mockResolvedValue(summary)
  })

  it('рисует таблицу районов с процентами, прочерком и итогом', async () => {
    renderWithProviders(<SummaryPage />, { route: '/summary' })
    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Район', 'Выявлено (неудовлетворительные ОЛХ)', 'Исправлено', 'На проверке', '% исправления'])

    const aero = within(table).getByRole('row', { name: /Аэропорт/ })
    expect(within(aero).getByText('66,7%')).toBeInTheDocument()
    expect(within(aero).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '66.7')
    expect(within(table).getByRole('row', { name: /Сокол/ })).toHaveTextContent('70%')
    const kopt = within(table).getByRole('row', { name: /Коптево/ })
    expect(within(kopt).getByText('—')).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Итого по САО/ })).toHaveTextContent('Итого по САО1391')

    expect(screen.getAllByText('69,2%').length).toBeGreaterThanOrEqual(2) // карточка «Исправлено %» и строка «Итого»
    expect(
      screen.getByText(
        'Исправлено — принято администратором префектуры. Процент = исправлено / выявлено × 100. При отсутствии нарушений — прочерк.',
      ),
    ).toBeInTheDocument()
  })

  it('смена периода перезапрашивает свод', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SummaryPage />, { route: '/summary' })
    await screen.findByRole('table')
    expect(summaryApi.get).toHaveBeenLastCalledWith({ period: 'all' })
    await user.click(screen.getByRole('button', { name: 'Неделя' }))
    expect(summaryApi.get).toHaveBeenLastCalledWith({ period: 'week' })
    expect(screen.getByRole('button', { name: 'Неделя' })).toHaveAttribute('aria-pressed', 'true')
  })
})
