import type { ReactNode } from 'react'
import type { Photo } from '@/types'

interface Props {
  label: 'ДО' | 'ПОСЛЕ'
  photo: Photo | null
  count?: number
  onOpen?: (photo: Photo) => void
  /** Что показать, если фото нет. */
  empty: ReactNode
  large?: boolean
}

export function PhotoTile({ label, photo, count = 0, onOpen, empty, large = false }: Props) {
  const tag = (
    <span
      className={`absolute left-2 top-2 z-10 rounded-md px-2 py-0.5 text-xs font-bold tracking-wide text-white ${
        label === 'ДО' ? 'bg-slate-900/75' : 'bg-brand-600/90'
      }`}
    >
      {label}
    </span>
  )

  if (!photo) {
    return (
      <div
        className={`relative flex h-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 pt-9 text-center ${
          large ? 'min-h-72' : 'min-h-40'
        }`}
      >
        {tag}
        {empty}
      </div>
    )
  }

  const image = (
    <img
      src={large ? photo.url : photo.thumbnail_url}
      alt={`Фото ${label}`}
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
  // Высота — не меньше 4:3 от ширины (распорка pb-[75%]), но ячейка может
  // и вытянуться по соседней пустой ячейке ПОСЛЕ. aspect-ratio здесь не
  // годится: при растяжении по высоте он раздувает ширину, и фото ДО
  // наезжало на соседнюю колонку (а на телефоне — выходило за экран).
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-slate-200">
      <div className="pb-[75%]" aria-hidden />
      {tag}
      {onOpen ? (
        <button
          type="button"
          className="absolute inset-0 cursor-zoom-in"
          aria-label={`Открыть фото ${label}`}
          onClick={(e) => {
            e.stopPropagation()
            onOpen(photo)
          }}
        >
          {image}
        </button>
      ) : (
        image
      )}
      {count > 1 && (
        <span className="absolute bottom-2 right-2 rounded-md bg-slate-900/75 px-2 py-0.5 text-xs font-semibold text-white">
          ещё {count - 1}
        </span>
      )}
    </div>
  )
}
