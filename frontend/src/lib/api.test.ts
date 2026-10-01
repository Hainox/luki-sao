import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, LoggedOutError, authApi, cardsApi, retryAfterRelogin } from '@/lib/api'
import { TOKEN_KEY, useAuthStore } from '@/stores/auth'
import { cardDetail, districtUser, expiredReply, fakeServer } from '@/test/utils'

describe('клиент API: истёкший вход', () => {
  beforeEach(() => useAuthStore.getState().login('old-token', districtUser))
  afterEach(() => vi.unstubAllGlobals())

  it('401 не уводит на /login и не стирает сессию — открывает окно повторного входа', async () => {
    fakeServer(() => expiredReply)
    await expect(cardsApi.get('card-1')).rejects.toMatchObject({ response: { status: 401 } })
    expect(window.location.pathname).toBe('/')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('old-token')
    expect(useAuthStore.getState().token).toBe('old-token')
    expect(useAuthStore.getState().relogin).toBe('expired')
  })

  it('401 на самом входе — ответ по существу, окно не открывает и старый токен не шлёт', async () => {
    const requests = fakeServer(() => ({ status: 401, body: { detail: 'Неверный логин или пароль' } }))
    await expect(authApi.login('petrov', 'wrong')).rejects.toBeInstanceOf(ApiError)
    expect(requests[0].auth).toBeNull()
    expect(useAuthStore.getState().relogin).toBeNull()
  })

  it('401 по токену, который уже сменили, пока шёл запрос, — входить заново не просит и повторяет с новым', async () => {
    const requests = fakeServer((r) => {
      if (r.auth === 'Bearer new-token') return { status: 200, body: cardDetail() }
      useAuthStore.getState().login('new-token', districtUser)
      return expiredReply
    })
    await expect(retryAfterRelogin(() => cardsApi.get('card-1'))).resolves.toMatchObject({ id: 'card-1' })
    expect(requests.map((r) => r.auth)).toEqual(['Bearer old-token', 'Bearer new-token'])
    expect(useAuthStore.getState().relogin).toBeNull()
  })

  it('запрос ждёт повторного входа и повторяется; при выходе — LoggedOutError', async () => {
    let calls = 0
    fakeServer((r) => {
      calls++
      return r.auth === 'Bearer new-token' ? { status: 200, body: cardDetail() } : expiredReply
    })
    const resumed = retryAfterRelogin(() => cardsApi.get('card-1'))
    await vi.waitFor(() => expect(useAuthStore.getState().relogin).toBe('expired'))
    useAuthStore.getState().login('new-token', districtUser)
    await expect(resumed).resolves.toMatchObject({ id: 'card-1' })
    expect(calls).toBe(2)

    useAuthStore.getState().login('old-token', districtUser)
    const abandoned = retryAfterRelogin(() => cardsApi.get('card-1'))
    await vi.waitFor(() => expect(useAuthStore.getState().relogin).toBe('expired'))
    useAuthStore.getState().logout()
    await expect(abandoned).rejects.toBeInstanceOf(LoggedOutError)
  })
})
