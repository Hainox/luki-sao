import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import NewCardPage from '@/pages/NewCardPage'
import { cardsApi, districtsApi } from '@/lib/api'
import { cardDetail, districtUser, prefectureUser, renderWithProviders } from '@/test/utils'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    cardsApi: { ...actual.cardsApi, create: vi.fn(), uploadPhoto: vi.fn() },
    districtsApi: { list: vi.fn() },
  }
})

const jpeg = () => new File(['jpeg'], 'IMG_0001.jpg', { type: 'image/jpeg' })

function renderPage(user = districtUser) {
  return renderWithProviders(
    <Routes>
      <Route path="/cards/new" element={<NewCardPage />} />
      <Route path="/cards/:id" element={<div>Карточка открыта</div>} />
    </Routes>,
    { route: '/cards/new', user },
  )
}

const submitButton = () => screen.getByRole('button', { name: 'Зафиксировать нарушение' })

describe('NewCardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    vi.mocked(districtsApi.list).mockResolvedValue([
      { id: 'd-aero', name: 'Аэропорт' },
      { id: 'd-sokol', name: 'Сокол' },
    ])
  })

  it('кнопка заблокирована с понятной причиной, пока нет фото и адреса', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('button', { name: /Сделать фото ДО/ })).toBeInTheDocument()
    expect(screen.getByText('Район:', { exact: false })).toHaveTextContent('Район: Аэропорт')

    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Сделайте хотя бы одно фото ДО')

    await user.upload(screen.getByTestId('camera-input'), jpeg())
    expect(screen.getByText('Выбрано: 1', { exact: false })).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Укажите адрес')

    await user.type(screen.getByLabelText('Адрес'), 'ул. Усиевича, 10')
    expect(submitButton()).toBeEnabled()
    expect(screen.queryByTestId('submit-reason')).not.toBeInTheDocument()
  })

  it('создаёт карточку своего района и загружает фото ДО', async () => {
    const user = userEvent.setup()
    const created = cardDetail({ id: 'card-9', label: 'ОЛХ-009' })
    vi.mocked(cardsApi.create).mockResolvedValue(created)
    vi.mocked(cardsApi.uploadPhoto).mockResolvedValue(created.photos[0])
    renderPage()

    const file = jpeg()
    await user.upload(screen.getByTestId('camera-input'), file)
    await user.type(screen.getByLabelText('Адрес'), 'ул. Усиевича, 10')
    await user.type(screen.getByLabelText('Комментарий (необязательно)'), 'Провал крышки')
    await user.click(submitButton())

    await waitFor(() => expect(screen.getByText('Карточка открыта')).toBeInTheDocument())
    expect(cardsApi.create).toHaveBeenCalledWith({
      address: 'ул. Усиевича, 10',
      district_id: undefined,
      comment: 'Провал крышки',
      lat: undefined,
      lon: undefined,
    })
    expect(cardsApi.uploadPhoto).toHaveBeenCalledWith('card-9', 'before', file)
  })

  it('не принимает файлы, которые не являются фотографиями', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderPage()
    await user.upload(screen.getByTestId('gallery-input'), new File(['<svg/>'], 'evil.svg', { type: 'image/svg+xml' }))
    expect(screen.getByText('Выбрано: 0', { exact: false })).toBeInTheDocument()
  })

  it('префектура обязана выбрать район', async () => {
    const user = userEvent.setup()
    vi.mocked(cardsApi.create).mockResolvedValue(cardDetail({ id: 'card-2' }))
    vi.mocked(cardsApi.uploadPhoto).mockResolvedValue(cardDetail().photos[0])
    renderPage(prefectureUser)

    await user.upload(screen.getByTestId('camera-input'), jpeg())
    await user.type(screen.getByLabelText('Адрес'), 'ул. Зорге, 1')
    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Выберите район')

    await screen.findByRole('option', { name: 'Сокол' })
    await user.selectOptions(screen.getByLabelText('Район'), 'd-sokol')
    expect(submitButton()).toBeEnabled()
    await user.click(submitButton())
    await waitFor(() => expect(cardsApi.create).toHaveBeenCalled())
    expect(vi.mocked(cardsApi.create).mock.calls[0][0].district_id).toBe('d-sokol')
  })

  it('без района в журнале обходов создать карточку нельзя', () => {
    renderPage({ ...districtUser, role: 'reviewer', district_id: null, district_name: null, can_create_cards: false })
    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('вам не назначен район')
  })
})
