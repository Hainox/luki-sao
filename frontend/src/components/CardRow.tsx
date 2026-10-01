import { Link, useNavigate } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { AddPhotoButton } from '@/components/AddPhotoButton'
import { PhotoTile } from '@/components/PhotoTile'
import { StatusPill } from '@/components/StatusPill'
import { formatDateTime } from '@/lib/format'
import { MAX_PHOTOS } from '@/lib/photoUpload'
import { statusLine } from '@/lib/status'
import type { CardListItem } from '@/types'
import { PlaceBadge } from '@/components/PlaceBadge'

function AfterEmpty({ card }: { card: CardListItem }) {
  const returned = card.status === 'returned'
  const canFix = card.permissions.can_add_after && (card.status === 'detected' || returned)
  return (
    <>
      <Camera className="h-7 w-7 text-slate-400" aria-hidden />
      <div className="text-sm font-semibold text-slate-700">
        {returned ? 'Ожидает повторного исправления' : 'Ожидает исправления'}
      </div>
      <div className="text-xs text-slate-500">
        {returned
          ? 'Вернули на доработку — добавьте новую фотографию после устранения'
          : 'После устранения нарушения добавьте фотографию'}
      </div>
      {canFix && (
        <AddPhotoButton
          cardId={card.id}
          kind="after"
          label={returned ? 'Добавить новое фото ПОСЛЕ' : 'Добавить фото ПОСЛЕ'}
          remaining={MAX_PHOTOS}
          className="mt-1 w-full [&_button]:min-h-11 [&_button]:whitespace-normal [&_button]:px-2 [&_button]:text-sm max-sm:[&_svg]:hidden"
        />
      )}
    </>
  )
}

export function CardRow({ card }: { card: CardListItem }) {
  const navigate = useNavigate()
  const open = () => navigate(`/cards/${card.id}`)
  // После возврата прежнее фото ПОСЛЕ уже отклонено — показываем пустую
  // ячейку с призывом переснять, а отклонённое остаётся в истории карточки.
  const afterPhoto = card.status === 'returned' ? null : card.after_photo

  return (
    <article
      data-testid="card-row"
      onClick={open}
      className="card grid cursor-pointer grid-cols-1 gap-4 p-4 transition-shadow hover:shadow-md md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,13rem)] md:gap-6 md:p-5"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <Link
            to={`/cards/${card.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-2xl font-bold tracking-tight text-slate-900 hover:text-brand-600"
          >
            {card.label}
          </Link>
          <div className="shrink-0 md:hidden">
            <StatusPill status={card.status} />
          </div>
        </div>
        <div className="flex items-start gap-1.5 font-semibold text-slate-800">
          <PlaceBadge kind={card.place_kind} />
          <span>{card.address}</span>
        </div>
        <div className="text-sm text-slate-600">Район: {card.district_name}</div>
        <div className="text-sm text-slate-500">{formatDateTime(card.created_at)}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <PhotoTile
          label="ДО"
          photo={card.before_photo}
          count={card.before_count}
          empty={<div className="text-sm text-slate-500">Фото ДО не загружено</div>}
        />
        <PhotoTile
          label="ПОСЛЕ"
          photo={afterPhoto}
          count={afterPhoto ? card.after_count : 0}
          empty={<AfterEmpty card={card} />}
        />
      </div>

      <div className="flex flex-col items-start gap-1.5">
        <div className="hidden md:block">
          <StatusPill status={card.status} />
        </div>
        <div className="text-sm text-slate-500">{formatDateTime(card.status_changed_at)}</div>
        <div className={`text-sm ${card.status === 'returned' ? 'font-semibold text-orange-700' : 'text-slate-700'}`}>
          {statusLine(card)}
        </div>
      </div>
    </article>
  )
}
