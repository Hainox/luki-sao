import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import SummaryPage from '@/pages/SummaryPage'
import DistrictSummaryPage from '@/pages/DistrictSummaryPage'
import { summaryApi } from '@/lib/api'
import { districtUser, prefectureUser, renderWithProviders } from '@/test/utils'
import type { DistrictSummary, Summary, SummaryRow, User } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    summaryApi: { get: vi.fn(), xlsx: vi.fn(), district: vi.fn(), districtXlsx: vi.fn() },
  }
})

function row(id: string | null, name: string, detected: number, fixed: number, onReview: number): SummaryRow {
  return { district_id: id, district_name: name, detected, fixed, on_review: onReview, percent: null, percent_label: '' }
}

const summary: Summary = {
  period: { kind: 'all', date_from: null, date_to: null, label: 'За всё время' },
  rows: [row('d-aero', 'Аэропорт', 3, 2, 1), row('d-kopt', 'Коптево', 0, 0, 0), row('d-sokol', 'Сокол', 10, 7, 0)],
  total: row(null, 'Итого по САО', 13, 9, 1),
}

const districtSummary: DistrictSummary = {
  district: { id: 'd-aero', name: 'Аэропорт' },
  period: { kind: 'all', date_from: null, date_to: null, label: 'За всё время' },
  totals: {
    detected: 3,
    accepted: 2,
    on_review: 1,
    open: 0,
    returned_now: 0,
    percent_text: '66,7%',
    returns_count: 1,
    avg_days_to_accept: 2.5,
  },
  dynamics_unit: 'day',
  dynamics: [],
  oldest_open: [],
}

function renderSummary(route: string, user: User) {
  return renderWithProviders(
    <Routes>
      <Route path="/summary" element={<SummaryPage />} />
      <Route path="/summary/:districtId" element={<DistrictSummaryPage />} />
    </Routes>,
    { route, user },
  )
}

describe('SummaryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(summaryApi.get).mockResolvedValue(summary)
    vi.mocked(summaryApi.district).mockResolvedValue(districtSummary)
  })

  it('префектура видит таблицу районов с процентами, прочерком и итогом', async () => {
    renderSummary('/summary', prefectureUser)
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
    expect(summaryApi.district).not.toHaveBeenCalled()
  })

  it('смена периода перезапрашивает свод', async () => {
    const user = userEvent.setup()
    renderSummary('/summary', prefectureUser)
    await screen.findByRole('table')
    expect(summaryApi.get).toHaveBeenLastCalledWith({ period: 'all' })
    await user.click(screen.getByRole('button', { name: 'Неделя' }))
    expect(summaryApi.get).toHaveBeenLastCalledWith({ period: 'week' })
    expect(screen.getByRole('button', { name: 'Неделя' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('префектура открывает подробный свод района с тем же периодом и возвращается к таблице', async () => {
    const user = userEvent.setup()
    vi.mocked(summaryApi.district).mockResolvedValue({
      ...districtSummary,
      district: { id: 'd-sokol', name: 'Сокол' },
    })
    renderSummary('/summary?period=week', prefectureUser)
    const table = await screen.findByRole('table')
    expect(within(table).queryByRole('link', { name: /Итого/ })).not.toBeInTheDocument()
    const link = within(table).getByRole('link', { name: 'Сокол' })
    expect(link).toHaveAttribute('href', '/summary/d-sokol?period=week')
    // На телефоне та же ссылка — вся карточка района.
    const mobile = screen.getByRole('list', { name: 'Свод по районам' })
    expect(within(mobile).getByRole('link', { name: /Сокол/ })).toHaveAttribute('href', '/summary/d-sokol?period=week')

    await user.click(link)
    expect(await screen.findByRole('heading', { name: 'Свод по району: Сокол' })).toBeInTheDocument()
    expect(summaryApi.district).toHaveBeenLastCalledWith({ period: 'week', district_id: 'd-sokol' })

    const back = screen.getByRole('link', { name: 'Все районы' })
    expect(back).toHaveAttribute('href', '/summary?period=week')
    await user.click(back)
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('сотрудник района сразу видит свой район и не запрашивает свод по округу', async () => {
    renderSummary('/summary', districtUser)
    expect(await screen.findByRole('heading', { name: 'Свод по району: Аэропорт' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('district-kpis')).toHaveTextContent('66,7%'))
    expect(summaryApi.district).toHaveBeenCalledWith({ period: 'all', district_id: undefined })
    expect(summaryApi.get).not.toHaveBeenCalled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Сокол')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Все районы' })).not.toBeInTheDocument()
  })

  it('сотрудника района по ссылке на чужой район возвращает к своему', async () => {
    renderSummary('/summary/d-sokol?period=month', districtUser)
    expect(await screen.findByRole('heading', { name: 'Свод по району: Аэропорт' })).toBeInTheDocument()
    expect(summaryApi.district).toHaveBeenCalledWith({ period: 'month', district_id: undefined })
    expect(summaryApi.district).not.toHaveBeenCalledWith(expect.objectContaining({ district_id: 'd-sokol' }))
    expect(summaryApi.get).not.toHaveBeenCalled()
  })

  it.each(['inspector', 'reviewer'] as const)('без района (%s) свода нет — только объяснение', async (role) => {
    renderSummary('/summary', {
      ...districtUser,
      role,
      district_id: null,
      district_name: null,
      can_create_cards: false,
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'В журнале обходов вам не назначен район — фотожурнал и свод недоступны. Обратитесь к администратору журнала обходов.',
    )
    expect(summaryApi.get).not.toHaveBeenCalled()
    expect(summaryApi.district).not.toHaveBeenCalled()
  })
})
