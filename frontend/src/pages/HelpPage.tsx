import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, MessageSquareWarning, Search, X } from 'lucide-react'
import Layout from '@/components/Layout'
import { HatchMark } from '@/components/HatchMark'
import { useAuthStore } from '@/stores/auth'
import { FAQ_ROLE_CHIPS, FAQ_TOPICS, filterFaq, type FaqRoleFilter } from '@/lib/faq'
import type { User } from '@/types'

const FEEDBACK_URL = 'https://obhod-sao.ru/feedback'

const topicDomId = (topicId: string) => `faq-topic-${topicId}`

// Ссылка вида /help?topic=proverka у сотрудника района иначе открыла бы
// пустую страницу: его роль по умолчанию скрыла бы все вопросы темы.
function initialRole(user: User | null, deepTopic: string | null): FaqRoleFilter {
  if (!user) return 'all'
  const role: FaqRoleFilter = user.is_prefecture ? 'prefecture' : 'district'
  if (deepTopic && filterFaq(FAQ_TOPICS, role, '').every((t) => t.id !== deepTopic)) return 'all'
  return role
}

/** Помощь открывается и без входа (с экрана входа: «не получается войти»),
 *  поэтому сама решает, в какой оболочке показываться. */
export default function HelpRoute() {
  const token = useAuthStore((s) => s.token)
  if (token) {
    return (
      <Layout>
        <HelpPage />
      </Layout>
    )
  }
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 bg-brand-700 px-4 py-3 text-white">
        <HatchMark className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold leading-tight">Люки САО</div>
          <div className="truncate text-xs text-white/75">Журнал самоконтроля</div>
        </div>
        <Link to="/login" className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold hover:bg-white/10">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Ко входу
        </Link>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4">
        <HelpPage />
      </main>
    </div>
  )
}

export function HelpPage() {
  const [searchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const deepTopic = searchParams.get('topic')

  const [role, setRole] = useState<FaqRoleFilter>(() => initialRole(user, deepTopic))
  const [query, setQuery] = useState('')
  const [openTopics, setOpenTopics] = useState<Set<string>>(() => new Set(deepTopic ? [deepTopic] : []))
  const [openItems, setOpenItems] = useState<Set<string>>(() => new Set())

  const topics = useMemo(() => filterFaq(FAQ_TOPICS, role, query), [role, query])
  const isSearching = query.trim().length > 0

  useEffect(() => {
    if (!deepTopic) return
    setOpenTopics((prev) => (prev.has(deepTopic) ? prev : new Set(prev).add(deepTopic)))
    document.getElementById(topicDomId(deepTopic))?.scrollIntoView?.({ block: 'start' })
  }, [deepTopic])

  const toggle = (setter: typeof setOpenTopics, key: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Помощь</h1>
        <p className="mt-1 text-slate-600">Ответы на частые вопросы</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          className="field pl-10 pr-12 [&::-webkit-search-cancel-button]:hidden"
          placeholder="Поиск: пароль, фото, свод…"
          aria-label="Поиск по вопросам"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {isSearching && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Очистить поиск"
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Для кого вопросы">
          {FAQ_ROLE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={role === chip.value}
              onClick={() => setRole(chip.value)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
                role === chip.value ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-brand-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          «Район» — инспекторы и проверяющие районов, «Префектура» — администраторы журнала обходов.
        </p>
      </div>

      {topics.length === 0 ? (
        <div className="card p-5 text-center text-slate-700" role="status">
          Ничего не нашлось. Попробуйте другое слово или напишите в поддержку.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {topics.map((topic) => {
            const topicOpen = isSearching || openTopics.has(topic.id)
            const panelId = `${topicDomId(topic.id)}-panel`
            return (
              <section key={topic.id} id={topicDomId(topic.id)} className="card scroll-mt-4 overflow-hidden">
                <h2>
                  <button
                    type="button"
                    aria-expanded={topicOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(setOpenTopics, topic.id)}
                    className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <span className="font-bold text-slate-900">{topic.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                      {topic.items.length}
                      <ChevronDown className={`h-5 w-5 transition-transform ${topicOpen ? 'rotate-180' : ''}`} aria-hidden />
                    </span>
                  </button>
                </h2>
                {topicOpen && (
                  <ul id={panelId} className="divide-y divide-slate-100 border-t border-slate-100">
                    {topic.items.map((item, index) => {
                      const itemKey = `${topic.id}:${item.q}`
                      const itemOpen = openItems.has(itemKey)
                      const answerId = `${topicDomId(topic.id)}-a${index}`
                      return (
                        <li key={itemKey}>
                          <button
                            type="button"
                            aria-expanded={itemOpen}
                            aria-controls={answerId}
                            onClick={() => toggle(setOpenItems, itemKey)}
                            className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3 text-left text-[15px] font-semibold text-slate-800 hover:bg-slate-50"
                          >
                            <span>{item.q}</span>
                            <ChevronDown
                              className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${itemOpen ? 'rotate-180' : ''}`}
                              aria-hidden
                            />
                          </button>
                          {itemOpen && (
                            <div id={answerId} className="-mt-1 px-4 pb-4 text-[15px] leading-relaxed text-slate-600">
                              {item.a}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
            <MessageSquareWarning className="h-5 w-5 text-brand-700" aria-hidden />
          </div>
          <div>
            <div className="font-bold text-slate-900">Не нашли ответ?</div>
            <div className="text-sm text-slate-500">
              Опишите проблему в форме обращений журнала обходов — можно без входа и со скриншотом.
            </div>
          </div>
        </div>
        <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="btn-primary shrink-0">
          Написать в поддержку
        </a>
      </div>
    </div>
  )
}
