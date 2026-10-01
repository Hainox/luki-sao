import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import DistrictSummaryPage from '@/pages/DistrictSummaryPage'
import SummaryPage from '@/pages/SummaryPage'
import { ApiError, summaryApi } from '@/lib/api'
import { saveBlob } from '@/lib/download'
import { districtUser, prefectureUser, renderWithProviders } from '@/test/utils'
import type { DistrictSummary, User } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    summaryApi: { get: vi.fn(), xlsx: vi.fn(), district: vi.fn(), districtXlsx: vi.fn() },
  }
})
vi.mock('@/lib/download', () => ({ saveBlob: vi.fn() }))

const full: DistrictSummary = {
  district: { id: 'd-aero', name: 'Аэропорт' },
  period: { kind: 'month', date_from: '2026-09-02', date_to: '2026-10-01', label: '02.09.2026 — 01.10.2026' },
  totals: {
    detected: 12,
    accepted: 7,
    on_review: 2,
    open: 3,
    returned_now: 1,
    percent_text: '58,3%',
    returns_count: 4,
    avg_days_to_accept: 2.5,
  },
  dynamics_unit: 'day',
  dynamics: [
    { label: '30.09', date_from: '2026-09-30', date_to: '2026-09-30', detected: 3, accepted: 2, percent_text: '66,7%' },
    { label: '01.10', date_from: '2026-10-01', date_to: '2026-10-01', detected: 0, accepted: 0, percent_text: '—' },
  ],
  oldest_open: [
    {
      id: 'card-1',
      label: 'ОЛХ-001',
      address: 'ул. Усиевича, д. 10',
      status: 'returned',
      created_at: '2026-09-19T08:15:00Z',
      age_days: 12,
    },
    {
      id: 'card-5',
      label: 'ОЛХ-005',
      address: 'ул. Зорге, д. 1',
      status: 'detected',
      created_at: '2026-09-25T08:15:00Z',
      age_days: 6,
    },
  ],
}

const empty: DistrictSummary = {
  ...full,
  period: { kind: 'all', date_from: null, date_to: null, label: 'За всё время' },
  totals: {
    detected: 0,
    accepted: 0,
    on_review: 0,
    open: 0,
    returned_now: 0,
    percent_text: '—',
    returns_count: 0,
    avg_days_to_accept: null,
  },
  dynamics: [],
  oldest_open: [],
}

function renderPage(route: string, user: User = districtUser) {
  return renderWithProviders(
    <Routes>
      <Route path="/summary" element={<SummaryPage />} />
      <Route path="/summary/:districtId" element={<DistrictSummaryPage />} />
    </Routes>,
    { route, user },
  )
}

function kpi(label: string): HTMLElement {
  const kpis = screen.getByTestId('district-kpis')
  return within(kpis).getByText(label).parentElement!
}

describe('Подробный свод по району', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(summaryApi.district).mockResolvedValue(full)
  })

  it('показатели района', async () => {
    renderPage('/summary?period=month')
    expect(await screen.findByRole('heading', { name: 'Свод по району: Аэропорт' })).toBeInTheDocument()
    await waitFor(() => expect(kpi('Выявлено')).toHaveTextContent('Выявлено12'))
    expect(kpi('Исправлено')).toHaveTextContent('Исправлено7')
    expect(kpi('На проверке')).toHaveTextContent('На проверке2')
    expect(kpi('Не исправлено')).toHaveTextContent('Не исправлено3')
    expect(kpi('% исправления')).toHaveTextContent('% исправления58,3%')
    expect(kpi('Возвратов на доработку')).toHaveTextContent('Возвратов на доработку4')
    expect(kpi('Среднее время до приёмки')).toHaveTextContent('Среднее время до приёмки2,5 дн.')
    expect(screen.getByText('02.09.2026 — 01.10.2026 (по московскому времени)')).toBeInTheDocument()
    expect(screen.getByText(/Процент = исправлено \/ выявлено × 100/)).toBeInTheDocument()
    expect(screen.getByText(/все неисправленные карточки района, независимо от периода/)).toBeInTheDocument()
  })

  it('без нарушений — прочерки и пустые списки', async () => {
    vi.mocked(summaryApi.district).mockResolvedValue(empty)
    renderPage('/summary')
    await waitFor(() => expect(kpi('Выявлено')).toHaveTextContent('Выявлено0'))
    expect(kpi('% исправления')).toHaveTextContent('% исправления—')
    expect(kpi('Среднее время до приёмки')).toHaveTextContent('Среднее время до приёмки—')
    expect(screen.getByText('Карточек пока нет.')).toBeInTheDocument()
    expect(screen.getByText('Неисправленных карточек нет.')).toBeInTheDocument()
  })

  it('динамика по дням с процентом и полосой', async () => {
    renderPage('/summary?period=month')
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'День',
      'Выявлено',
      'Исправлено',
      '% исправления',
    ])
    const day = within(table).getByRole('row', { name: /30\.09/ })
    expect(day).toHaveTextContent('30.093266,7%')
    expect(within(day).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '66.7')
    expect(within(table).getByRole('row', { name: /01\.10/ })).toHaveTextContent('01.1000—')
  })

  it('динамика по месяцам — колонка «Месяц»', async () => {
    vi.mocked(summaryApi.district).mockResolvedValue({
      ...full,
      dynamics_unit: 'month',
      dynamics: [
        { label: 'сентябрь 2026', date_from: '2026-09-02', date_to: '2026-09-30', detected: 4, accepted: 1, percent_text: '25%' },
      ],
    })
    renderPage('/summary')
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('Месяц')
    expect(within(table).getByRole('row', { name: /сентябрь 2026/ })).toHaveTextContent('25%')
  })

  it('давние неисправленные карточки ведут в карточку', async () => {
    renderPage('/summary')
    const list = await screen.findByRole('list', { name: 'Дольше всех ждут исправления' })
    const links = within(list).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/cards/card-1', '/cards/card-5'])
    expect(links[0]).toHaveTextContent('ОЛХ-001')
    expect(links[0]).toHaveTextContent('ул. Усиевича, д. 10')
    expect(links[0]).toHaveTextContent('Возвращено')
    expect(links[0]).toHaveTextContent('12 дн.')
    expect(links[0]).toHaveTextContent('с 19.09.2026')
    expect(links[1]).toHaveTextContent('Выявлено')
    expect(links[1]).toHaveTextContent('6 дн.')
  })

  it('Excel района — с тем же периодом и именем района в файле', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['xlsx'])
    vi.mocked(summaryApi.districtXlsx).mockResolvedValue(blob)
    renderPage('/summary/d-aero?period=month', prefectureUser)
    await screen.findByRole('heading', { name: 'Свод по району: Аэропорт' })
    await user.click(screen.getByRole('button', { name: 'Скачать Excel' }))
    await waitFor(() => expect(saveBlob).toHaveBeenCalled())
    expect(summaryApi.districtXlsx).toHaveBeenCalledWith({ period: 'month', district_id: 'd-aero' })
    expect(saveBlob).toHaveBeenCalledWith(blob, 'Свод по люкам — Аэропорт 02.09.2026 — 01.10.2026.xlsx')
  })

  it('отказ сервера показываем его словами', async () => {
    vi.mocked(summaryApi.district).mockRejectedValue(
      new ApiError('HTTP 403', {
        response: { status: 403, data: { detail: 'Статистика другого района вам недоступна' } },
      }),
    )
    renderPage('/summary')
    expect(await screen.findByRole('alert')).toHaveTextContent('Статистика другого района вам недоступна')
  })
})
