import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, ImagePlus, RotateCcw } from 'lucide-react'
import { ApiError, cardsApi, describeError, isRetryable } from '@/lib/api'
import { PHOTO_ACCEPT, photoProblem, uploadWithRetry } from '@/lib/photoUpload'
import { notify } from '@/lib/toast'
import { invalidateCardQueries } from '@/lib/queries'
import type { PhotoKind } from '@/types'

interface Props {
  cardId: string
  kind: PhotoKind
  label: string
  /** Сколько фото ещё можно добавить (лимит сервера — 5 на набор). */
  remaining: number
  withGallery?: boolean
  className?: string
  onUploaded?: () => void
}

export function AddPhotoButton({ cardId, kind, label, remaining, withGallery = false, className = '', onUploaded }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<string | null>(null)
  // Фото, не ушедшие даже после автоповторов, не пропадают молча: остаются
  // с кнопкой «Отправить ещё раз», пока сотрудник сам не отправит их.
  const [failed, setFailed] = useState<File[]>([])

  const send = async (files: File[]) => {
    let sent = 0
    let conflict = false
    const stuck: File[] = []
    for (const [i, file] of files.entries()) {
      setProgress(files.length > 1 ? `Отправляем ${i + 1} из ${files.length}…` : 'Отправляем…')
      try {
        await uploadWithRetry(() => cardsApi.uploadPhoto(cardId, kind, file))
        sent++
      } catch (err) {
        notify.error(describeError(err, 'Фото не отправилось'))
        if (isRetryable(err)) stuck.push(file)
        // 409 — карточка изменилась (решение префектуры, лимит фото).
        // Остальные фото пачки сняты к прежнему состоянию: после возврата
        // на доработку они молча открыли бы новую попытку.
        conflict = err instanceof ApiError && err.response?.status === 409
        if (conflict) break
      }
    }
    setProgress(null)
    setFailed(stuck)
    if (sent > 0) {
      notify.success(kind === 'after' ? 'Фото ПОСЛЕ добавлено — карточка на проверке у префектуры' : 'Фото ДО добавлено')
      onUploaded?.()
    }
    if (sent > 0 || conflict) invalidateCardQueries(queryClient, cardId)
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    const good: File[] = []
    for (const file of picked) {
      const problem = photoProblem(file)
      if (problem) notify.error(problem)
      else good.push(file)
    }
    if (good.length > remaining) notify.error(`Можно добавить ещё не больше ${remaining} фото`)
    const batch = good.slice(0, remaining)
    if (batch.length) void send(batch)
  }

  const busy = progress !== null
  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <input ref={cameraRef} type="file" accept={PHOTO_ACCEPT} capture="environment" multiple hidden onChange={onPick} />
      <input ref={galleryRef} type="file" accept={PHOTO_ACCEPT} multiple hidden onChange={onPick} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary flex-1 whitespace-nowrap"
          disabled={busy || remaining <= 0}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-5 w-5 shrink-0" aria-hidden />
          {progress ?? label}
        </button>
        {withGallery && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || remaining <= 0}
            onClick={() => galleryRef.current?.click()}
          >
            <ImagePlus className="h-5 w-5 shrink-0" aria-hidden />
            Из галереи
          </button>
        )}
      </div>
      {failed.length > 0 && !busy && (
        <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Не отправлено фото: {failed.length}. Проверьте связь.
          <button type="button" className="btn-secondary mt-2 w-full" onClick={() => void send(failed)}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Отправить ещё раз
          </button>
        </div>
      )}
    </div>
  )
}
