import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { useAuthStore } from '@/stores/auth'
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
import type { CardDetail } from '@/types'

const jpeg = (name: string) => new File(['x'], name, { type: 'image/jpeg' })
const loginOk = { status: 200, body: { access_token: 'new-token', user: districtUser } }
const isUpload = (r: FakeRequest) => r.path === '/api/cards/card-1/photos?kind=after'

function detected(): CardDetail {
  return cardDetail({ permissions: { can_add_before: false, can_add_after: true, can_review: false } })
}

function renderCard(token = 'old-token') {
  const view = renderWithProviders(<App />, { route: '/cards/card-1', token })
  const gallery = () => view.container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]
  return { ...view, gallery }
}

async function relogin(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Время входа истекло' })
  await user.type(within(dialog).getByLabelText('Пароль'), 'secret')
  await user.click(within(dialog).getByRole('button', { name: 'Войти' }))
}

describe('AddPhotoButton: вход истёк во время отправки ПОСЛЕ', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('401 — отправка ждёт входа, затем продолжается без потерь и повторов', async () => {
    const user = userEvent.setup()
    let card = detected()
    let uploads = 0
    const requests = fakeServer((r) => {
      if (r.path === '/api/auth/me') return { status: 200, body: districtUser }
      if (r.path === '/api/auth/login') return loginOk
      if (r.method === 'GET' && r.path === '/api/cards/card-1') return { status: 200, body: card }
      if (isUpload(r)) {
        uploads++
        if (uploads === 2) return expiredReply
        card = { ...card, status: 'on_review', current_attempt: 1 }
        return { status: 201, body: photo('after', 1, `after-${uploads}`) }
      }
      return { status: 404 }
    })
    const { gallery } = renderCard()
    await screen.findByRole('button', { name: /Добавить фото ПОСЛЕ/ })

    await user.upload(gallery(), [jpeg('1.jpg'), jpeg('2.jpg'), jpeg('3.jpg')])
    await relogin(user)

    await waitFor(() => expect(requests.filter(isUpload)).toHaveLength(4))
    expect(requests.filter(isUpload).map((r) => r.auth)).toEqual([
      'Bearer old-token',
      'Bearer old-token',
      'Bearer new-token',
      'Bearer new-token',
    ])
    await waitFor(() => expect(screen.queryByText(/^Отправляем/)).not.toBeInTheDocument())
    expect(screen.queryByText(/Не отправлено фото/)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('пока входили, префектура вернула карточку — остальные фото пачки не открывают новую попытку', async () => {
    const user = userEvent.setup()
    let card = detected()
    let uploads = 0
    const requests = fakeServer((r) => {
      if (r.path === '/api/auth/me') return { status: 200, body: districtUser }
      if (r.path === '/api/auth/login') return loginOk
      if (r.method === 'GET' && r.path === '/api/cards/card-1') return { status: 200, body: card }
      if (isUpload(r)) {
        uploads++
        if (uploads === 2) {
          card = { ...card, status: 'returned', current_attempt: 1 }
          return expiredReply
        }
        card = { ...card, status: 'on_review', current_attempt: 1 }
        return { status: 201, body: photo('after', 1) }
      }
      return { status: 404 }
    })
    const { gallery } = renderCard()
    await screen.findByRole('button', { name: /Добавить фото ПОСЛЕ/ })

    await user.upload(gallery(), [jpeg('1.jpg'), jpeg('2.jpg'), jpeg('3.jpg')])
    await relogin(user)

    await waitFor(() => expect(screen.queryByText(/^Отправляем/)).not.toBeInTheDocument())
    expect(requests.filter(isUpload)).toHaveLength(2)
  })

  it('вход кончается через 10 минут — сначала окно входа, камера потом', async () => {
    const user = userEvent.setup()
    fakeServer((r) => {
      if (r.path === '/api/auth/me') return { status: 200, body: districtUser }
      if (r.method === 'GET' && r.path === '/api/cards/card-1') return { status: 200, body: detected() }
      return { status: 404 }
    })
    const { container } = renderCard(fakeJwt(10 * 60_000))
    const button = await screen.findByRole('button', { name: /Добавить фото ПОСЛЕ/ })
    const camera = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const openCamera = vi.spyOn(camera, 'click')

    await user.click(button)
    const dialog = await screen.findByRole('dialog', { name: 'Вход скоро закончится' })
    expect(openCamera).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Позже' }))
    await user.click(button)
    expect(openCamera).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useAuthStore.getState().relogin).toBeNull()
  })
})
