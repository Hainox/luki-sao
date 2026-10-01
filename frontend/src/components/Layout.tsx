import type { ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, CircleHelp, ClipboardCheck, Images, LogOut } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cardsApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { hasNoJournal, roleLabel } from '@/lib/roles'
import { HatchMark } from '@/components/HatchMark'
import { ReloginDialog } from '@/components/ReloginDialog'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  badge?: number
}

function useNavItems(): NavItem[] {
  const user = useAuthStore((s) => s.user)
  const isPrefecture = Boolean(user?.is_prefecture)
  const { data: queue } = useQuery({
    queryKey: ['review-queue'],
    queryFn: cardsApi.reviewQueue,
    enabled: isPrefecture,
    refetchInterval: 60_000,
  })
  if (!user) return []
  const help: NavItem = { to: '/help', label: 'Помощь', icon: CircleHelp }
  // Без района ни журнала, ни свода нет — на главной только объяснение,
  // куда обратиться (см. NoDistrictNotice); «Помощь» остаётся: там же
  // объяснено, что делать.
  if (hasNoJournal(user)) return [help]
  const items: NavItem[] = [{ to: '/', label: 'Фотожурнал', icon: Images, end: true }]
  if (isPrefecture) items.push({ to: '/review', label: 'Проверка', icon: ClipboardCheck, badge: queue?.total })
  items.push({ to: '/summary', label: 'Свод', icon: BarChart3 })
  items.push(help)
  return items
}

function Badge({ value }: { value?: number }) {
  if (!value) return null
  return (
    <span className="ml-auto min-w-6 rounded-full bg-amber-400 px-1.5 text-center text-xs font-bold leading-6 text-amber-950">
      {value > 99 ? '99+' : value}
    </span>
  )
}

/** children — для страниц вне маршрутов с входом (Помощь открывается и без
 *  него); обычные разделы приходят через Outlet. */
export default function Layout({ children }: { children?: ReactNode }) {
  const items = useNavItems()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const onLogout = () => {
    logout()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen md:flex">
      {/* Боковая панель — только на широком экране */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-brand-700 px-4 py-6 text-white md:flex">
        <div className="flex items-center gap-3 px-2">
          <HatchMark className="h-10 w-10" />
          <div>
            <div className="text-lg font-bold leading-tight">Люки САО</div>
            <div className="text-sm text-white/75">Журнал самоконтроля</div>
          </div>
        </div>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Разделы">
          {items.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors ${
                  isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{label}</span>
              <Badge value={badge} />
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-white/10 p-3">
          <div className="truncate text-sm font-semibold">{user?.full_name || user?.login}</div>
          <div className="truncate text-xs text-white/75">{user ? roleLabel(user) : ''}</div>
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/25 text-sm font-semibold hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Выйти
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Шапка — только на телефоне */}
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-brand-700 px-4 py-3 text-white md:hidden">
          <HatchMark className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold leading-tight">Люки САО</div>
            <div className="truncate text-xs text-white/75">{user ? roleLabel(user) : 'Журнал самоконтроля'}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Выйти
          </button>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">
          {children ?? <Outlet />}
        </main>

        {/* Нижняя навигация — только на телефоне */}
        {items.length > 0 && (
          <nav
            className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-brand-700 text-white md:hidden"
            aria-label="Разделы"
          >
            <div className="flex">
              {items.map(({ to, label, icon: Icon, end, badge }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold ${
                      isActive ? 'bg-brand-600 text-white' : 'text-white/75'
                    }`
                  }
                >
                  <Icon className="h-6 w-6" aria-hidden />
                  <span>{label}</span>
                  {badge ? (
                    <span className="absolute right-[calc(50%-26px)] top-1.5 min-w-5 rounded-full bg-amber-400 px-1 text-center text-[11px] font-bold leading-5 text-amber-950">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>

      <ReloginDialog />
    </div>
  )
}
