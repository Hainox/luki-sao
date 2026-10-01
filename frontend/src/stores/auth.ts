import { create } from 'zustand'
import { serverNow, tokenExpiresAt } from '@/lib/session'
import type { User } from '@/types'

export const TOKEN_KEY = 'luki_token'
export const USER_KEY = 'luki_user'

/** Окно повторного входа поверх страницы: 'expired' — сервер уже ответил
 *  401, запросы ждут входа; 'expiring' — вход вот-вот закончится,
 *  предупреждаем заранее, пока фото ещё не сняты. */
export type Relogin = 'expired' | 'expiring' | null

export const EXPIRING_SOON_MS = 15 * 60_000

interface AuthState {
  token: string | null
  user: User | null
  relogin: Relogin
  /** Токен, для которого сотрудник нажал «Позже», — с ним больше не спрашиваем. */
  postponedFor: string | null
  login: (token: string, user: User) => void
  logout: () => void
  setUser: (user: User) => void
  expire: () => void
  postpone: () => void
}

// Сессия читается синхронно при создании стора, а не в эффекте после
// первого рендера — иначе защищённый маршрут успевает перекинуть на /login
// раньше, чем сессия восстановится (так в журнале обходов PWA по прямой
// ссылке навсегда выкидывало на экран входа).
function loadSession(): { token: string | null; user: User | null } {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const raw = localStorage.getItem(USER_KEY)
    if (token && raw) return { token, user: JSON.parse(raw) as User }
  } catch {
    // повреждённые данные или недоступное хранилище — просто без сессии
  }
  return { token: null, user: null }
}

function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // приватный режим браузера: сессия проживёт до закрытия вкладки
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadSession(),
  relogin: null,
  postponedFor: null,
  login: (token, user) => {
    save(TOKEN_KEY, token)
    save(USER_KEY, JSON.stringify(user))
    set({ token, user, relogin: null, postponedFor: null })
  },
  logout: () => {
    save(TOKEN_KEY, null)
    save(USER_KEY, null)
    set({ token: null, user: null, relogin: null, postponedFor: null })
  },
  setUser: (user) => {
    save(USER_KEY, JSON.stringify(user))
    set({ user })
  },
  expire: () => {
    if (get().token) set({ relogin: 'expired' })
  },
  postpone: () => {
    if (get().relogin === 'expiring') set({ relogin: null, postponedFor: get().token })
  },
}))

/** Открывает окно входа заранее, если вход закончится в ближайшие 15 минут:
 *  войти до съёмки проще, чем потом. true — окно открыто, начинать работу
 *  пока не нужно. */
export function askReloginIfExpiring(): boolean {
  const { token, relogin, postponedFor } = useAuthStore.getState()
  if (relogin) return true
  if (!token || postponedFor === token) return false
  const expiresAt = tokenExpiresAt(token)
  if (expiresAt === null || expiresAt - serverNow() > EXPIRING_SOON_MS) return false
  useAuthStore.setState({ relogin: 'expiring' })
  return true
}

/** Ждёт, чем закончится окно повторного входа: true — вошли снова и
 *  запрос можно повторить, false — сотрудник вышел. */
export function waitForRelogin(): Promise<boolean> {
  const outcome = (s: AuthState) => (!s.token ? false : s.relogin === 'expired' ? null : true)
  return new Promise((resolve) => {
    const now = outcome(useAuthStore.getState())
    if (now !== null) {
      resolve(now)
      return
    }
    const unsubscribe = useAuthStore.subscribe((s) => {
      const result = outcome(s)
      if (result === null) return
      unsubscribe()
      resolve(result)
    })
  })
}
