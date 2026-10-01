import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { CircleHelp, Eye, EyeOff, LogIn } from 'lucide-react'
import { ApiError, authApi, describeError } from '@/lib/api'
import { HatchMark } from '@/components/HatchMark'
import { useAuthStore } from '@/stores/auth'

export default function LoginPage() {
  const token = useAuthStore((s) => s.token)
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mustChange, setMustChange] = useState(false)
  const [pending, setPending] = useState(false)

  if (token) return <Navigate to="/" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginValue.trim() || !password) {
      setError('Введите логин и пароль')
      return
    }
    setPending(true)
    setError(null)
    setMustChange(false)
    try {
      const res = await authApi.login(loginValue.trim(), password)
      login(res.access_token, res.user)
      navigate('/', { replace: true })
    } catch (err) {
      const status = err instanceof ApiError ? err.response?.status : undefined
      setMustChange(status === 403)
      setError(
        status === 422
          ? 'Неверный логин или пароль'
          : describeError(err, 'Не удалось войти — попробуйте ещё раз'),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-700 px-4 py-10">
      <div className="mb-6 flex items-center gap-3 text-white">
        <HatchMark className="h-14 w-14" />
        <div>
          <div className="text-3xl font-bold leading-tight">Люки САО</div>
          <div className="text-white/80">Журнал самоконтроля</div>
        </div>
      </div>
      <form onSubmit={submit} className="card w-full max-w-sm p-6" noValidate>
        <h1 className="text-lg font-bold">Вход</h1>
        <p className="mb-5 mt-1 text-sm text-slate-600">Вход по логину и паролю журнала обходов</p>
        <label htmlFor="login" className="label">
          Логин
        </label>
        <input
          id="login"
          className="field"
          value={loginValue}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setLoginValue(e.target.value)}
        />
        <label htmlFor="password" className="label mt-4">
          Пароль
        </label>
        <div className="relative">
          <input
            id="password"
            className="field pr-28"
            type={showPassword ? 'text' : 'password'}
            value={password}
            autoComplete="current-password"
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
              <a href="https://obhod-sao.ru" target="_blank" rel="noreferrer" className="mt-1 block font-semibold underline">
                Открыть журнал обходов
              </a>
            )}
          </div>
        )}
        <button type="submit" className="btn-primary mt-5 w-full" disabled={pending}>
          <LogIn className="h-5 w-5" aria-hidden />
          {pending ? 'Входим…' : 'Войти'}
        </button>
        <Link to="/help?topic=vhod" className="mt-3 flex min-h-11 items-center justify-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
          <CircleHelp className="h-4 w-4" aria-hidden />
          Не получается войти? Помощь
        </Link>
      </form>
    </div>
  )
}
