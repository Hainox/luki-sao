import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { useAuthStore } from '@/stores/auth'
import { districtUser, fakeServer, renderWithProviders } from '@/test/utils'

describe('LoginPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('неверный пароль — обычная ошибка на странице входа, без окна повторного входа', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const requests = fakeServer((r) => {
      if (r.path === '/api/auth/login') {
        return ++attempts === 1
          ? { status: 401, body: { detail: 'Неверный логин или пароль' } }
          : { status: 200, body: { access_token: 'token-1', user: districtUser } }
      }
      if (r.path === '/api/auth/me') return { status: 200, body: districtUser }
      if (r.path.startsWith('/api/cards?')) {
        return { status: 200, body: { items: [], total: 0, page: 1, page_size: 20, counts: { all: 0, open: 0, on_review: 0, accepted: 0 }, period: { kind: 'all', date_from: null, date_to: null, label: 'За всё время' } } }
      }
      return { status: 404 }
    })
    renderWithProviders(<App />, { route: '/login', user: null })

    await user.type(screen.getByLabelText('Логин'), 'petrov')
    await user.type(screen.getByLabelText('Пароль'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный логин или пароль')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useAuthStore.getState().relogin).toBeNull()

    await user.clear(screen.getByLabelText('Пароль'))
    await user.type(screen.getByLabelText('Пароль'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('heading', { name: 'Фотожурнал' })).toBeInTheDocument()
    expect(requests.filter((r) => r.path === '/api/auth/login').map((r) => r.body)).toEqual([
      { login: 'petrov', password: 'wrong' },
      { login: 'petrov', password: 'secret' },
    ])
  })
})
