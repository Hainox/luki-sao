import { create } from 'zustand'
import { TOKEN_KEY, USER_KEY } from '@/lib/api'
import type { User } from '@/types'

interface AuthState {
  token: string | null
  user: User | null
  login: (token: string, user: User) => void
  logout: () => void
  setUser: (user: User) => void
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

export const useAuthStore = create<AuthState>((set) => ({
  ...loadSession(),
  login: (token, user) => {
    save(TOKEN_KEY, token)
    save(USER_KEY, JSON.stringify(user))
    set({ token, user })
  },
  logout: () => {
    save(TOKEN_KEY, null)
    save(USER_KEY, null)
    set({ token: null, user: null })
  },
  setUser: (user) => {
    save(USER_KEY, JSON.stringify(user))
    set({ user })
  },
}))
