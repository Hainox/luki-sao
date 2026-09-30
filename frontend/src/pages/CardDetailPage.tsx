import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, CircleDot, MapPin, RotateCcw, Send } from 'lucide-react'
import { cardsApi, describeError } from '@/lib/api'
import { AddPhotoButton } from '@/components/AddPhotoButton'
import { PhotoLightbox } from '@/components/PhotoLightbox'
import { ReviewActions } from '@/components/ReviewActions'
import { StatusPill } from '@/components/StatusPill'
import { formatDateTime } from '@/lib/format'
import { MAX_PHOTOS } from '@/lib/photoUpload'
import { statusLine } from '@/lib/status'
import type { CardDetail, CardEvent, Photo } from '@/types'

const EVENT_TEXT: Record<CardEvent['kind'], string> = {
  created: 'Нарушение зафиксировано',
  after_uploaded: 'Добавлено фото ПОСЛЕ — отправлено на проверку',
  accepted: 'Принято префектурой',
  returned: 'Возвращено на доработку',
}

const EVENT_ICON = {
  created: CircleDot,
  after_uploaded: Send,
  accepted: CheckCircle2,
  returned: RotateCcw,
} as const

const EVENT_COLOR: Record<CardEvent['kind'], string> = {
  created: 'text-red-600 bg-red-50',
  after_uploaded: 'text-amber-700 bg-amber-50',
  accepted: 'text-emerald-700 bg-emerald-50',
  returned: 'text-orange-700 bg-orange-50',
}

function PhotoGrid({ photos, onOpen }: { photos: Photo[]; onOpen: (p: Photo) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((p) => (
        <figure key={p.id} className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => onOpen(p)}
            className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-200"
            aria-label={`Открыть фото от ${formatDateTime(p.created_at)}`}
          >
            <img src={p.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
          <figcaption className="text-xs text-slate-500">
            {formatDateTime(p.created_at)}
            <br />
            {p.uploaded_by.full_name}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

function attemptOutcome(card: CardDetail, attempt: number): { text: string; tone: string } {
  const decision = [...card.events].reverse().find(
    (e) => e.attempt === attempt && (e.kind === 'accepted' || e.kind === 'returned'),
  )
  if (decision?.kind === 'accepted') return { text: 'Принято префектурой', tone: 'text-emerald-700' }
  if (decision?.kind === 'returned') {
    return { text: `Возвращено: ${decision.comment ?? ''}`, tone: 'text-orange-700' }
  }
  return { text: 'На проверке у префектуры', tone: 'text-amber-700' }
}

function CardBody({ card }: { card: CardDetail }) {
  const [opened, setOpened] = useState<Photo | null>(null)
  const befores = card.photos.filter((p) => p.kind === 'before')
  const attempts = [...new Set(card.photos.filter((p) => p.kind === 'after').map((p) => p.attempt))].sort((a, b) => b - a)
  const latestAfterCount = card.photos.filter((p) => p.kind === 'after' && p.attempt === card.current_attempt).length
  const afterLabel =
    card.status === 'on_review' ? 'Добавить ещё фото ПОСЛЕ' : card.status === 'returned' ? 'Добавить новое фото ПОСЛЕ' : 'Добавить фото ПОСЛЕ'

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{card.label}</h1>
          <StatusPill status={card.status} />
        </div>
        <div className="text-lg font-semibold text-slate-800">{card.address}</div>
        <dl className="grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <dt className="inline">Район: </dt>
            <dd className="inline font-semibold text-slate-800">{card.district_name}</dd>
          </div>
          <div>
            <dt className="inline">Зафиксировано: </dt>
            <dd className="inline">
              {formatDateTime(card.created_at)}, {card.created_by.full_name}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline">Состояние: </dt>
            <dd className="inline">{statusLine(card)}</dd>
          </div>
        </dl>
        {card.lat && card.lon && (
          <a
            href={`https://yandex.ru/maps/?pt=${card.lon},${card.lat}&z=18&l=map`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
          >
            <MapPin className="h-4 w-4" aria-hidden />
            На карте: {card.lat}, {card.lon}
          </a>
        )}
        {card.comment && (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <span className="font-semibold">Комментарий: </span>
            {card.comment}
          </p>
        )}
        {(card.permissions.can_add_before || card.permissions.can_add_after) && (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row">
            {card.permissions.can_add_after && (
              <AddPhotoButton
                cardId={card.id}
                kind="after"
                label={afterLabel}
                remaining={card.status === 'on_review' ? MAX_PHOTOS - latestAfterCount : MAX_PHOTOS}
                withGallery
                className="sm:flex-1"
              />
            )}
            {card.permissions.can_add_before && (
              <AddPhotoButton
                cardId={card.id}
                kind="before"
                label="Добавить фото ДО"
                remaining={MAX_PHOTOS - befores.length}
                withGallery
                className="sm:flex-1"
              />
            )}
          </div>
        )}
        {card.permissions.can_review && <ReviewActions card={card} />}
      </section>

      <section className="card flex flex-col gap-3 p-4 md:p-6">
        <h2 className="text-lg font-bold">Фото ДО</h2>
        {befores.length ? (
          <PhotoGrid photos={befores} onOpen={setOpened} />
        ) : (
          <p className="text-sm text-slate-500">Фото ДО не загружено.</p>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-4 md:p-6">
        <h2 className="text-lg font-bold">Фото ПОСЛЕ</h2>
        {attempts.length === 0 && <p className="text-sm text-slate-500">Ожидает исправления.</p>}
        {attempts.map((attempt) => {
          const outcome = attemptOutcome(card, attempt)
          return (
            <div key={attempt} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="font-semibold">Попытка {attempt}</h3>
                <span className={`text-sm font-semibold ${outcome.tone}`}>{outcome.text}</span>
              </div>
              <PhotoGrid
                photos={card.photos.filter((p) => p.kind === 'after' && p.attempt === attempt)}
                onOpen={setOpened}
              />
            </div>
          )
        })}
      </section>

      <section className="card flex flex-col gap-3 p-4 md:p-6">
        <h2 className="text-lg font-bold">История</h2>
        <ol className="flex flex-col gap-3">
          {card.events.map((e) => {
            const Icon = EVENT_ICON[e.kind]
            return (
              <li key={e.id} className="flex gap-3">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${EVENT_COLOR[e.kind]}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">
                    {EVENT_TEXT[e.kind]}
                    {e.kind === 'after_uploaded' && e.attempt && e.attempt > 1 ? ` (попытка ${e.attempt})` : ''}
                  </div>
                  {e.comment && <div className="text-sm text-orange-800">«{e.comment}»</div>}
                  <div className="text-sm text-slate-500">
                    {formatDateTime(e.created_at)} · {e.user.full_name}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <PhotoLightbox photo={opened} onClose={() => setOpened(null)} />
    </div>
  )
}

export default function CardDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['card', id], queryFn: () => cardsApi.get(id) })

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="inline-flex min-h-11 w-fit items-center gap-1.5 font-semibold text-brand-600 hover:underline">
        <ArrowLeft className="h-5 w-5" aria-hidden />
        К фотожурналу
      </Link>
      {query.isPending && <div className="card p-6 text-center text-slate-500">Загрузка…</div>}
      {query.isError && (
        <div role="alert" className="card p-6 text-red-800">
          {describeError(query.error, 'Не удалось открыть карточку')}
        </div>
      )}
      {query.data && <CardBody card={query.data} />}
    </div>
  )
}
