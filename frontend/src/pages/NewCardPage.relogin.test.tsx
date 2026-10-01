import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { TOKEN_KEY, useAuthStore } from '@/stores/auth'
import {
  cardDetail,
  districtUser,
  expiredReply,
  fakeJwt,
  fakeServer,
  photo,
  renderWithProviders,
  type FakeRequest,
} from '@/test/utils'

const jpeg = () => new File(['jpeg'], 'IMG_0001.jpg', { type: 'image/jpeg' })
const created = cardDetail({ id: 'card-9', label: 'ОЛХ-009' })
const loginOk = { status: 200, body: { access_token: 'new-token', user: districtUser } }

// Всё приложение целиком: окно входа живёт в Layout под RequireAuth, как на проде.
const renderPage = (token = 'old-token') => renderWithProviders(<App />, { route: '/cards/new', token })

const isUpload = (r: FakeRequest) => r.path === '/api/cards/card-9/photos?kind=before'
const isCreate = (r: FakeRequest) => r.method === 'POST' && r.path === '/api/cards'

/** Ответы, нужные приложению вокруг формы: сверка сессии и открытая после
 *  создания карточка. */
function common(r: FakeRequest) {
  if (r.path === '/api/auth/me') return { status: 200, body: districtUser }
  if (r.method === 'GET' && r.path === '/api/cards/card-9') return { status: 200, body: created }
  return { status: 404 }
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByTestId('camera-input'), jpeg())
  await user.type(screen.getByLabelText('Адрес'), 'ул. Усиевича, 10')
  await user.type(screen.getByLabelText('Комментарий (необязательно)'), 'Провал крышки')
}

describe('NewCardPage: вход истёк посреди работы', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('401 на фото ДО: окно входа поверх формы, после входа фото уходит один раз', async () => {
    const user = userEvent.setup()
    let uploads = 0
    const requests = fakeServer((r) => {
      if (isCreate(r)) return { status: 201, body: created }
      if (isUpload(r)) return ++uploads === 1 ? expiredReply : { status: 201, body: photo('before') }
      if (r.path === '/api/auth/login') return loginOk
      return common(r)
    })
    renderPage()
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Зафиксировать нарушение' }))

    const dialog = await screen.findByRole('dialog', { name: 'Время входа истекло' })
    expect(dialog).toHaveTextContent('Войдите снова — введённые данные и фото сохранены')
    // Страница под окном не тронута: адрес, комментарий и выбранное фото на месте.
    expect(screen.getByLabelText('Адрес')).toHaveValue('ул. Усиевича, 10')
    expect(screen.getByLabelText('Комментарий (необязательно)')).toHaveValue('Провал крышки')
    expect(screen.getByText('Выбрано: 1', { exact: false })).toBeInTheDocument()
    expect(screen.getByAltText('Фото ДО')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Логин')).toHaveValue('petrov')
    expect(within(dialog).getByLabelText('Логин')).toHaveAttribute('readonly')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('old-token')

    await user.type(within(dialog).getByLabelText('Пароль'), 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('heading', { name: 'ОЛХ-009' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const login = requests.find((r) => r.path === '/api/auth/login')!
    expect(login.body).toEqual({ login: 'petrov', password: 'secret' })
    expect(login.auth).toBeNull()
    expect(requests.filter(isCreate)).toHaveLength(1)
    const sent = requests.filter(isUpload)
    expect(sent.map((r) => r.auth)).toEqual(['Bearer old-token', 'Bearer new-token'])
    expect(useAuthStore.getState().token).toBe('new-token')
  })

  it('401 на создании карточки: после входа она создаётся с тем же id', async () => {
    const user = userEvent.setup()
    let creates = 0
    const requests = fakeServer((r) => {
      if (isCreate(r)) return ++creates === 1 ? expiredReply : { status: 201, body: created }
      if (isUpload(r)) return { status: 201, body: photo('before') }
      if (r.path === '/api/auth/login') return loginOk
      return common(r)
    })
    renderPage()
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Зафиксировать нарушение' }))

    const dialog = await screen.findByRole('dialog', { name: 'Время входа истекло' })
    await user.type(within(dialog).getByLabelText('Пароль'), 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('heading', { name: 'ОЛХ-009' })).toBeInTheDocument()
    const ids = requests.filter(isCreate).map((r) => (r.body as { id: string }).id)
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
    expect(requests.filter(isUpload)).toHaveLength(1)
  })

  it('«Выйти» в окне: черновик сбрасывается, открывается вход, фото больше не отправляются', async () => {
    const user = userEvent.setup()
    const requests = fakeServer((r) => {
      if (isCreate(r)) return { status: 201, body: created }
      if (isUpload(r)) return expiredReply
      return common(r)
    })
    renderPage()
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Зафиксировать нарушение' }))
    const dialog = await screen.findByRole('dialog', { name: 'Время входа истекло' })

    await user.click(within(dialog).getByRole('button', { name: 'Выйти' }))

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests.filter(isUpload)).toHaveLength(1)
  })

  it('вход кончается через 10 минут — окно сразу при открытии формы, «Позже» его закрывает', async () => {
    const user = userEvent.setup()
    fakeServer(common)
    renderPage(fakeJwt(10 * 60_000))

    const dialog = await screen.findByRole('dialog', { name: 'Вход скоро закончится' })
    expect(dialog).toHaveTextContent('Войдите снова, чтобы не потерять фото')
    await user.click(within(dialog).getByRole('button', { name: 'Позже' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Сделать фото ДО/ })).toBeEnabled()
  })

  it('до конца входа больше 15 минут — окна нет', () => {
    fakeServer(common)
    renderPage(fakeJwt(2 * 60 * 60_000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
