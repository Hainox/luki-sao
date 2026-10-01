import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import NewCardPage from '@/pages/NewCardPage'
import { ApiError, cardsApi, districtsApi, territoriesApi } from '@/lib/api'
import {
  cardDetail, chooseTerritory, districtUser, dtTerritory, odhTerritory, prefectureUser, renderWithProviders,
} from '@/test/utils'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    cardsApi: { ...actual.cardsApi, create: vi.fn(), uploadPhoto: vi.fn() },
    districtsApi: { list: vi.fn() },
    territoriesApi: { list: vi.fn(), nearby: vi.fn() },
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
    vi.mocked(territoriesApi.list).mockResolvedValue([
      dtTerritory,
      { ...dtTerritory, id: 't-dt-2', name: 'Острякова ул. 11, 9' },
      odhTerritory,
    ])
    vi.mocked(territoriesApi.nearby).mockResolvedValue([])
  })

  it('кнопка заблокирована с понятной причиной, пока нет фото и места люка', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('button', { name: /Сделать фото ДО/ })).toBeInTheDocument()
    expect(screen.getByText('Район:', { exact: false })).toHaveTextContent('Район: Аэропорт')

    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Сделайте хотя бы одно фото ДО')

    await user.upload(screen.getByTestId('camera-input'), jpeg())
    expect(screen.getByText('Выбрано: 1', { exact: false })).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Укажите, где найден люк: ДТ или ОДХ')

    await user.click(screen.getByRole('button', { name: /^ДТ/ }))
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Выберите дворовую территорию')
    // В списке только ДТ района: ОДХ появятся, если переключиться на «ОДХ».
    expect(await screen.findByRole('button', { name: 'Острякова ул. 11, 9' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: odhTerritory.name })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Найдите дворовую территорию'), 'усиевича 8')
    expect(screen.queryByRole('button', { name: 'Острякова ул. 11, 9' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: dtTerritory.name }))

    expect(screen.getByTestId('picked-territory')).toHaveTextContent('Балансодержатель: Жилищник Аэропорт')
    expect(submitButton()).toBeEnabled()
    expect(screen.queryByTestId('submit-reason')).not.toBeInTheDocument()

    // Сменили тип — выбранный объект сбрасывается: ДТ не может быть ОДХ.
    await user.click(screen.getByRole('button', { name: /^ОДХ/ }))
    expect(screen.queryByTestId('picked-territory')).not.toBeInTheDocument()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Выберите объект дорожного хозяйства')
  })

  it('создаёт карточку своего района и загружает фото ДО', async () => {
    const user = userEvent.setup()
    const created = cardDetail({ id: 'card-9', label: 'ОЛХ-009' })
    vi.mocked(cardsApi.create).mockResolvedValue(created)
    vi.mocked(cardsApi.uploadPhoto).mockResolvedValue(created.photos[0])
    renderPage()

    const file = jpeg()
    await user.upload(screen.getByTestId('camera-input'), file)
    await chooseTerritory(user, odhTerritory, 'аэропортовская')
    await user.type(screen.getByLabelText('Уточнение места (необязательно)'), 'напротив дома 5')
    await user.type(screen.getByLabelText('Комментарий (необязательно)'), 'Провал крышки')
    await user.click(submitButton())

    await waitFor(() => expect(screen.getByText('Карточка открыта')).toBeInTheDocument())
    expect(cardsApi.create).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      place_kind: 'odh',
      territory_id: 't-odh-1',
      address_note: 'напротив дома 5',
      district_id: undefined,
      comment: 'Провал крышки',
      lat: undefined,
      lon: undefined,
    })
    expect(cardsApi.uploadPhoto).toHaveBeenCalledWith('card-9', 'before', file)
  })

  it('повтор после потерянного ответа уходит с тем же id — вторая карточка не появится', async () => {
    const user = userEvent.setup()
    const created = cardDetail({ id: 'card-9', label: 'ОЛХ-009' })
    vi.mocked(cardsApi.create)
      .mockRejectedValueOnce(new ApiError('timeout', { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce(created)
    vi.mocked(cardsApi.uploadPhoto).mockResolvedValue(created.photos[0])
    renderPage()

    await user.upload(screen.getByTestId('camera-input'), jpeg())
    await chooseTerritory(user)
    await user.click(submitButton())
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())

    await waitFor(() => expect(screen.getByText('Карточка открыта')).toBeInTheDocument())
    const ids = vi.mocked(cardsApi.create).mock.calls.map(([body]) => body.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBe(ids[0])
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
    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('Выберите район')
    expect(screen.getByText(/Сначала выберите район/)).toBeInTheDocument()
    expect(territoriesApi.list).not.toHaveBeenCalled()

    await screen.findByRole('option', { name: 'Сокол' })
    await user.selectOptions(screen.getByLabelText('Район'), 'd-sokol')
    await chooseTerritory(user)
    expect(territoriesApi.list).toHaveBeenCalledWith('d-sokol')
    expect(submitButton()).toBeEnabled()

    // Другой район — свои объекты: выбор сбрасывается.
    await user.selectOptions(screen.getByLabelText('Район'), 'd-aero')
    expect(screen.queryByTestId('picked-territory')).not.toBeInTheDocument()
    await chooseTerritory(user)
    await user.click(submitButton())
    await waitFor(() => expect(cardsApi.create).toHaveBeenCalled())
    expect(vi.mocked(cardsApi.create).mock.calls[0][0].district_id).toBe('d-aero')
  })

  it('«Определить место» подсказывает объекты рядом и сам выбирает тип', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 55.8051234, longitude: 37.5123456, accuracy: 12 } } as GeolocationPosition),
      },
    })
    vi.mocked(territoriesApi.nearby).mockResolvedValue([
      { ...odhTerritory, distance_m: 0 },
      { ...dtTerritory, distance_m: 40 },
    ])
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Определить место' }))
    const near = await screen.findByRole('list', { name: 'Рядом с вами' })
    expect(territoriesApi.nearby).toHaveBeenCalledWith(55.805123, 37.512346, '')
    expect(near).toHaveTextContent(`ОДХ${odhTerritory.name}вы здесь`)
    expect(near).toHaveTextContent(`ДТ${dtTerritory.name}40 м`)

    await user.click(screen.getByRole('button', { name: /1-я Аэропортовская улица/ }))
    expect(screen.getByRole('button', { name: /^ОДХ/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('picked-territory')).toHaveTextContent('Заказчик: Жилищник Аэропорт')
    vi.unstubAllGlobals()
  })

  it('без района в журнале обходов создать карточку нельзя', () => {
    renderPage({ ...districtUser, role: 'reviewer', district_id: null, district_name: null, can_create_cards: false })
    expect(submitButton()).toBeDisabled()
    expect(screen.getByTestId('submit-reason')).toHaveTextContent('вам не назначен район')
  })
})
