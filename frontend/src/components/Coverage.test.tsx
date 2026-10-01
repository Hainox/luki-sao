import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DistrictSelect } from '@/components/DistrictSelect'
import { PeriodSelector } from '@/components/PeriodSelector'
import { PhotoLightbox } from '@/components/PhotoLightbox'
import { districtsApi } from '@/lib/api'
import { districtUser, photo, prefectureUser, renderWithProviders } from '@/test/utils'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, districtsApi: { list: vi.fn() } }
})

describe('DistrictSelect', () => {
  beforeEach(() => vi.clearAllMocks())

  it('сотрудник района видит свой район без запроса списка', async () => {
    renderWithProviders(<DistrictSelect user={districtUser} value="" onChange={() => {}} />)
    expect(await screen.findByText('Район: Аэропорт')).toBeInTheDocument()
    expect(districtsApi.list).not.toHaveBeenCalled()
  })

  it('префектура выбирает район из списка', async () => {
    vi.mocked(districtsApi.list).mockResolvedValue([{ id: 'd-aero', name: 'Аэропорт' }])
    const onChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<DistrictSelect user={prefectureUser} value="" onChange={onChange} />)
    await screen.findByRole('option', { name: 'Аэропорт' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Район' }), 'd-aero')
    expect(onChange).toHaveBeenCalledWith('d-aero')
  })
})

describe('PeriodSelector', () => {
  it('показывает точные границы периода с сервера по Москве', () => {
    renderWithProviders(
      <PeriodSelector
        value={{ period: 'custom', date_from: '2026-09-01', date_to: '2026-09-07' }}
        onChange={() => {}}
        resolved={{ kind: 'custom', date_from: '2026-09-01', date_to: '2026-09-07', label: '' }}
      />,
    )
    expect(screen.getByText(/01\.09\.2026 — 07\.09\.2026/)).toBeInTheDocument()
  })

  it('однодневный период — одна дата без тире', () => {
    renderWithProviders(
      <PeriodSelector
        value={{ period: 'today' }}
        onChange={() => {}}
        resolved={{ kind: 'today', date_from: '2026-09-15', date_to: '2026-09-15', label: '' }}
      />,
    )
    expect(screen.getByText(/15\.09\.2026/)).toBeInTheDocument()
  })
})

describe('PhotoLightbox', () => {
  it('показывает фото ПОСЛЕ с номером попытки и закрывается', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<PhotoLightbox photo={photo('after', 2)} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: /попытка 2/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('без фото ничего не рендерит', () => {
    const { container } = renderWithProviders(<PhotoLightbox photo={null} onClose={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
