import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, PartyPopper } from 'lucide-react'
import { cardsApi, describeError } from '@/lib/api'
import { PhotoLightbox } from '@/components/PhotoLightbox'
import { PhotoTile } from '@/components/PhotoTile'
import { ReviewActions } from '@/components/ReviewActions'
import { formatDateTime } from '@/lib/format'
import type { CardDetail, Photo } from '@/types'
import { PlaceBadge } from '@/components/PlaceBadge'

function Thumbs({ photos, onOpen }: { photos: Photo[]; onOpen: (p: Photo) => void }) {
  if (photos.length < 2) return null
  return (
    <div className="flex gap-2 overflow-x-auto">
      {photos.slice(1).map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p)}
          className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-200"
          aria-label="Открыть фото"
        >
          <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  )
}

function ReviewCard({ card, onDecided }: { card: CardDetail; onDecided: () => void }) {
  const [opened, setOpened] = useState<Photo | null>(null)
  const befores = card.photos.filter((p) => p.kind === 'before')
  const afters = card.photos.filter((p) => p.kind === 'after' && p.attempt === card.current_attempt)
  const sentEvent = [...card.events].reverse().find((e) => e.kind === 'after_uploaded')
  const lastReturn = [...card.events].reverse().find((e) => e.kind === 'returned')

  return (
    <article className="card flex flex-col gap-4 p-4 md:p-6" aria-label={`Проверка ${card.label}`}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-2xl font-bold tracking-tight">{card.label}</h2>
          <span className="inline-flex items-start gap-1.5 font-semibold text-slate-800">
            <PlaceBadge kind={card.place_kind} />
            <span>{card.address}</span>
          </span>
        </div>
        <div className="text-sm text-slate-600">
          Район: <b>{card.district_name}</b> · зафиксировал {card.created_by.full_name}, {formatDateTime(card.created_at)}
        </div>
        {sentEvent && (
          <div className="text-sm text-slate-600">
            Фото ПОСЛЕ: {sentEvent.user.full_name}, {formatDateTime(sentEvent.created_at)}
          </div>
        )}
        {card.current_attempt > 1 && (
          <div className="mt-1 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-900 ring-1 ring-orange-200">
            Повторная проверка — попытка {card.current_attempt}.
            {lastReturn?.comment ? ` В прошлый раз вернули: «${lastReturn.comment}»` : ''}
          </div>
        )}
        {card.comment && <div className="text-sm text-slate-600">Комментарий: {card.comment}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2 md:gap-4">
        <div className="flex flex-col gap-2">
          <PhotoTile
            label="ДО"
            photo={befores[0] ?? null}
            large
            onOpen={setOpened}
            empty={<div className="text-sm text-slate-500">Фото ДО не загружено</div>}
          />
          <Thumbs photos={befores} onOpen={setOpened} />
        </div>
        <div className="flex flex-col gap-2">
          <PhotoTile
            label="ПОСЛЕ"
            photo={afters[0] ?? null}
            large
            onOpen={setOpened}
            empty={<div className="text-sm text-slate-500">Фото ПОСЛЕ нет</div>}
          />
          <Thumbs photos={afters} onOpen={setOpened} />
        </div>
      </div>

      <ReviewActions card={card} onDecided={onDecided} />
      <Link to={`/cards/${card.id}`} className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
        Открыть карточку и историю
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
      <PhotoLightbox photo={opened} onClose={() => setOpened(null)} />
    </article>
  )
}

export default function ReviewPage() {
  const query = useQuery({ queryKey: ['review-queue'], queryFn: cardsApi.reviewQueue })
  // Решённые карточки убираем сразу, не дожидаясь перезагрузки очереди, —
  // иначе на пару секунд под кнопками осталась бы уже решённая карточка.
  const [decided, setDecided] = useState<string[]>([])
  const all = query.data?.items ?? []
  const items = all.filter((c) => !decided.includes(c.id))
  const remaining = Math.max(0, (query.data?.total ?? 0) - (all.length - items.length))
  const current = items[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Проверка</h1>
        {query.data && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
            В очереди: {remaining}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600">Сначала — карточки, которые ждут решения дольше всех.</p>

      {query.isPending && <div className="card p-6 text-center text-slate-500">Загрузка…</div>}
      {query.isError && (
        <div role="alert" className="card p-6 text-red-800">
          {describeError(query.error, 'Не удалось загрузить очередь проверки')}
        </div>
      )}
      {query.isSuccess && !current && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-slate-600">
          <PartyPopper className="h-8 w-8 text-emerald-600" aria-hidden />
          Очередь пуста — все карточки проверены.
        </div>
      )}

      {current && (
        <ReviewCard key={current.id} card={current} onDecided={() => setDecided((d) => [...d, current.id])} />
      )}

      {items.length > 1 && (
        <section className="card p-4">
          <h2 className="mb-2 font-bold">Далее в очереди</h2>
          <ul className="divide-y divide-slate-100">
            {items.slice(1).map((c) => (
              <li key={c.id}>
                <Link to={`/cards/${c.id}`} className="flex min-h-11 items-center gap-3 py-2 hover:text-brand-600">
                  <span className="font-bold">{c.label}</span>
                  <PlaceBadge kind={c.place_kind} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                    {c.address} · {c.district_name}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
