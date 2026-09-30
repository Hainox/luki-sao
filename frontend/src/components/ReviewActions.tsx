import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, RotateCcw, X } from 'lucide-react'
import { ApiError, cardsApi, describeError } from '@/lib/api'
import { invalidateCardQueries } from '@/lib/queries'
import { notify } from '@/lib/toast'
import type { CardDetail } from '@/types'

interface Props {
  card: CardDetail
  onDecided?: () => void
}

export function ReviewActions({ card, onDecided }: Props) {
  const queryClient = useQueryClient()
  const [returning, setReturning] = useState(false)
  const [comment, setComment] = useState('')

  const done = (message: string) => {
    notify.success(message)
    setReturning(false)
    setComment('')
    invalidateCardQueries(queryClient, card.id)
    onDecided?.()
  }

  const failed = (err: unknown, fallback: string) => {
    notify.error(describeError(err, fallback))
    // 409 — решение уже вынес другой сотрудник префектуры: без обновления
    // устаревшая карточка так и висела бы с кнопками.
    if (err instanceof ApiError && err.response?.status === 409) invalidateCardQueries(queryClient, card.id)
  }

  const accept = useMutation({
    mutationFn: () => cardsApi.accept(card.id),
    onSuccess: () => done(`${card.label} принята`),
    onError: (err) => failed(err, 'Не удалось принять карточку'),
  })
  const giveBack = useMutation({
    mutationFn: () => cardsApi.returnForRework(card.id, comment.trim()),
    onSuccess: () => done(`${card.label} возвращена на доработку`),
    onError: (err) => failed(err, 'Не удалось вернуть карточку'),
  })
  const busy = accept.isPending || giveBack.isPending

  if (returning) {
    const empty = comment.trim().length === 0
    return (
      <form
        className="flex flex-col gap-2 rounded-xl bg-orange-50 p-3 ring-1 ring-orange-200"
        onSubmit={(e) => {
          e.preventDefault()
          if (!empty) giveBack.mutate()
        }}
      >
        <label htmlFor={`return-${card.id}`} className="label">
          Что нужно исправить (обязательно)
        </label>
        <textarea
          id={`return-${card.id}`}
          className="field min-h-24"
          value={comment}
          maxLength={2000}
          autoFocus
          onChange={(e) => setComment(e.target.value)}
          placeholder="Например: крышка не закреплена, на фото не видно адрес"
        />
        {empty && <p className="text-sm text-orange-800">Без комментария вернуть нельзя — район должен понять, что исправить.</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" className="btn-warning sm:flex-1" disabled={empty || busy}>
            <RotateCcw className="h-5 w-5" aria-hidden />
            {giveBack.isPending ? 'Отправляем…' : 'Отправить на доработку'}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setReturning(false)}>
            <X className="h-5 w-5" aria-hidden />
            Отмена
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button type="button" className="btn-success sm:flex-1" disabled={busy} onClick={() => accept.mutate()}>
        <Check className="h-5 w-5" aria-hidden />
        {accept.isPending ? 'Принимаем…' : 'Принять'}
      </button>
      <button type="button" className="btn-warning sm:flex-1" disabled={busy} onClick={() => setReturning(true)}>
        <RotateCcw className="h-5 w-5" aria-hidden />
        Вернуть на доработку
      </button>
    </div>
  )
}
