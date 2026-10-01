import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { TOKEN_KEY, useAuthStore } from '@/stores/auth'
import { districtUser, expiredReply, fakeServer, listItem, renderWithProviders, type FakeRequest } from '@/test/utils'
import type { CardList } from '@/types'

const page: CardList = {
  items: [listItem()],
  total: 1,
  page: 1,
  page_size: 20,
  counts: { all: 1, open: 1, on_review: 0, accepted: 0 },
  period: { kind: 'all', date_from: null, date_to: null, label: 'За всё время' },
}

/** Журнал с просроченным входом: всё, кроме входа, отвечает 401, пока не
 *  придёт новый токен. */
function server(login: (r: FakeRequest) => { status: number; body?: unknown }) {
  return fakeServer((r) => {
    if (r.path === '/api/auth/login') return login(r)
    if (r.auth !== 'Bearer new-token') return expiredReply
    if (r.path === '/api/auth/me') return { status: 200, body: districtUser }
    if (r.path.startsWith('/api/cards?')) return { status: 200, body: page }
    return { status: 404 }
  })
}

async function openDialog() {
  renderWithProviders(<App />, { route: '/', token: 'old-token' })
  return screen.findByRole('dialog', { name: 'Время входа истекло' })
}

describe('ReloginDialog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('неверный пароль — ошибка в окне, окно остаётся; верный — журнал загружается заново', async () => {
    const user = userEvent.setup()
    let attempts = 0
    server(() =>
      ++attempts === 1
        ? { status: 401, body: { detail: 'Неверный логин или пароль' } }
        : { status: 200, body: { access_token: 'new-token', user: districtUser } },
    )
    const dialog = await openDialog()

    await user.type(within(dialog).getByLabelText('Пароль'), 'wrong')
    await user.click(within(dialog).getByRole('button', { name: 'Войти' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Неверный логин или пароль')
    expect(screen.getByRole('dialog', { name: 'Время входа истекло' })).toBeInTheDocument()
    expect(useAuthStore.getState().relogin).toBe('expired')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('old-token')

    await user.clear(within(dialog).getByLabelText('Пароль'))
    await user.type(within(dialog).getByLabelText('Пароль'), 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('ОЛХ-001')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('пустой пароль не отправляется', async () => {
    const user = userEvent.setup()
    const requests = server(() => ({ status: 500 }))
    const dialog = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: 'Войти' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Введите пароль')
    expect(requests.some((r) => r.path === '/api/auth/login')).toBe(false)
  })

  it('403 «Сначала смените пароль…» показывается в окне со ссылкой на журнал обходов', async () => {
    const user = userEvent.setup()
    server(() => ({
      status: 403,
      body: { detail: 'Сначала смените пароль в журнале обходов (obhod-sao.ru), затем войдите снова' },
    }))
    const dialog = await openDialog()
    await user.type(within(dialog).getByLabelText('Пароль'), 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'Войти' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Сначала смените пароль в журнале обходов')
    expect(within(alert).getByRole('link', { name: 'Открыть журнал обходов' })).toHaveAttribute('href', 'https://obhod-sao.ru')
    expect(useAuthStore.getState().relogin).toBe('expired')
  })

  it('вошёл другой сотрудник — черновик не его: выход на страницу входа', async () => {
    const user = userEvent.setup()
    server(() => ({ status: 200, body: { access_token: 'new-token', user: { ...districtUser, id: 'u-2', login: 'sidorov' } } }))
    const dialog = await openDialog()
    await user.type(within(dialog).getByLabelText('Пароль'), 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})
