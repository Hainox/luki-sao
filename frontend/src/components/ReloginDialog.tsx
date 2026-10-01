import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, Eye, EyeOff, LogIn, LogOut } from 'lucide-react'
import { ApiError, authApi, describeError } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types'

const TEXT = {
  expired: { title: 'Время входа истекло', body: 'Войдите снова — введённые данные и фото сохранены' },
  expiring: { title: 'Вход скоро закончится', body: 'Войдите снова, чтобы не потерять фото' },
}

/** Повторный вход поверх текущей страницы. Страница под окном не
 *  размонтируется: выбранные фото, заполненная форма и ждущие входа
 *  отправки остаются как были. */
export function ReloginDialog() {
  const relogin = useAuthStore((s) => s.relogin)
  const user = useAuthStore((s) => s.user)
  if (!relogin || !user) return null
  return <ReloginForm kind={relogin} user={user} />
}

function ReloginForm({ kind, user }: { kind: 'expired' | 'expiring'; user: User }) {
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)
  const postpone = useAuthStore((s) => s.postpone)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mustChange, setMustChange] = useState(false)
  const [pending, setPending] = useState(false)

  const leave = () => {
    void authApi.logout().catch(() => {}).finally(() => {
      logout()
      queryClient.clear()
      navigate('/login', { replace: true })
    })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) {
      setError('Введите пароль')
      return
    }
    setPending(true)
    setError(null)
    setMustChange(false)
    try {
      const res = await authApi.login(user.login, password)
      // Черновик на странице — того, кто его начал. Если вошёл кто-то
      // другой, черновик ему не достаётся: выходим так же, как по «Выйти».
      if (res.user.id !== user.id) {
        leave()
        return
      }
      login(res.access_token, res.user)
      // Журнал, карточка и прочее, что не загрузилось, пока вход был
      // просрочен, — загружаем заново.
      void queryClient.invalidateQueries({ predicate: (q) => q.state.status === 'error' })
    } catch (err) {
      const status = err instanceof ApiError ? err.response?.status : undefined
      setMustChange(status === 403)
      setError(
        status === 422 ? 'Неверный логин или пароль' : describeError(err, 'Не удалось войти — попробуйте ещё раз'),
      )
      setPending(false)
    }
  }

  const text = TEXT[kind]
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="relogin-title"
        aria-describedby="relogin-text"
        onSubmit={submit}
        noValidate
        className="card w-full max-w-sm p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <Clock className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 id="relogin-title" className="text-lg font-bold">
              {text.title}
            </h2>
            <p id="relogin-text" className="mt-1 text-sm text-slate-600">
              {text.body}
            </p>
          </div>
        </div>

        <label htmlFor="relogin-login" className="label mt-4">
          Логин
        </label>
        <input
          id="relogin-login"
          className="field bg-slate-100! text-slate-600!"
          value={user.login}
          readOnly
          autoComplete="username"
        />
        <label htmlFor="relogin-password" className="label mt-4">
          Пароль
        </label>
        <div className="relative">
          <input
            id="relogin-password"
            className="field pr-28"
            type={showPassword ? 'text' : 'password'}
            value={password}
            autoComplete="current-password"
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-1 flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand-600"
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            {showPassword ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        {error && (
          <div role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
            {error}
            {mustChange && (
              <a href="https://obhod-sao.ru" target="_blank" rel="noreferrer" className="mt-1 flex min-h-11 items-center font-semibold underline">
                Открыть журнал обходов
              </a>
            )}
          </div>
        )}

        <button type="submit" className="btn-primary mt-5 w-full" disabled={pending}>
          <LogIn className="h-5 w-5" aria-hidden />
          {pending ? 'Входим…' : 'Войти'}
        </button>
        <div className="mt-2 flex gap-2">
          {kind === 'expiring' && (
            <button type="button" className="btn-secondary flex-1" disabled={pending} onClick={postpone}>
              Позже
            </button>
          )}
          <button type="button" className="btn-secondary flex-1" disabled={pending} onClick={leave}>
            <LogOut className="h-4 w-4" aria-hidden />
            Выйти
          </button>
        </div>
      </form>
    </div>
  )
}
