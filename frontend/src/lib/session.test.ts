import { afterEach, describe, expect, it } from 'vitest'
import { rememberServerTime, serverNow, tokenExpiresAt } from '@/lib/session'
import { askReloginIfExpiring, useAuthStore } from '@/stores/auth'
import { districtUser, fakeJwt } from '@/test/utils'

describe('tokenExpiresAt', () => {
  it('читает exp из JWT', () => {
    const token = fakeJwt(60_000)
    const exp = tokenExpiresAt(token)!
    expect(Math.abs(exp - (Date.now() + 60_000))).toBeLessThan(1500)
  })

  it('не JWT или без exp — null', () => {
    expect(tokenExpiresAt('token')).toBeNull()
    expect(tokenExpiresAt('a.b.c')).toBeNull()
    expect(tokenExpiresAt(`x.${btoa(JSON.stringify({ sub: 'u-1' }))}.y`)).toBeNull()
  })
})

describe('askReloginIfExpiring', () => {
  afterEach(() => rememberServerTime(new Date().toUTCString()))

  it('по часам сервера, а не телефона: телефон спешит на 9 часов — свежий вход не просит войти снова', () => {
    // Сервер выдал токен на 8 часов по своим часам; по часам телефона он
    // «истёк» час назад.
    useAuthStore.getState().login(fakeJwt(-60 * 60_000), districtUser)
    rememberServerTime(new Date(Date.now() - 9 * 60 * 60_000).toUTCString())
    expect(Math.abs(serverNow() - (Date.now() - 9 * 60 * 60_000))).toBeLessThan(1500)
    expect(askReloginIfExpiring()).toBe(false)
    expect(useAuthStore.getState().relogin).toBeNull()
  })

  it('после «Позже» для этого же входа больше не спрашивает', () => {
    useAuthStore.getState().login(fakeJwt(5 * 60_000), districtUser)
    expect(askReloginIfExpiring()).toBe(true)
    expect(useAuthStore.getState().relogin).toBe('expiring')
    useAuthStore.getState().postpone()
    expect(askReloginIfExpiring()).toBe(false)
    expect(useAuthStore.getState().relogin).toBeNull()
  })
})
