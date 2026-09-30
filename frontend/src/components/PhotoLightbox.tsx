import { useEffect } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import type { Photo } from '@/types'

export function PhotoLightbox({ photo, onClose }: { photo: Photo | null; onClose: () => void }) {
  useEffect(() => {
    if (!photo) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photo, onClose])

  if (!photo) return null
  const title = photo.kind === 'before' ? 'Фото ДО' : `Фото ПОСЛЕ, попытка ${photo.attempt}`
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 text-white"
      onClick={onClose}
    >
      <div className="flex items-center gap-3 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title}</div>
          <div className="truncate text-sm text-white/70">
            {formatDateTime(photo.created_at)} · {photo.uploaded_by.full_name}
          </div>
        </div>
        <a
          href={photo.original_url}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold hover:bg-white/10"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Оригинал
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-semibold hover:bg-white/20"
        >
          <X className="h-5 w-5" aria-hidden />
          Закрыть
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <img src={photo.url} alt={title} className="max-h-full max-w-full rounded-lg object-contain" />
      </div>
    </div>
  )
}
