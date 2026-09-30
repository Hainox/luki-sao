import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, ImagePlus, LocateFixed, RotateCcw, Trash2, X } from 'lucide-react'
import { cardsApi, describeError, districtsApi, isRetryable } from '@/lib/api'
import { MAX_PHOTOS, PHOTO_ACCEPT, photoProblem, uploadWithRetry } from '@/lib/photoUpload'
import { invalidateCardQueries } from '@/lib/queries'
import { submitBlocker } from '@/lib/newCard'
import { notify } from '@/lib/toast'
import { useAuthStore } from '@/stores/auth'
import type { CardDetail } from '@/types'

type Coords = { lat: number; lon: number; accuracy: number }

function PhotoPreview({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState('')
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-200">
      {url && !broken ? (
        <img src={url} alt="Фото ДО" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        // HEIC с iPhone показывает только Safari — в других браузерах
        // превью нет, но само фото загрузится и сервер сделает JPEG.
        <div className="flex h-full items-center justify-center p-2 text-center text-xs text-slate-600">{file.name}</div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="absolute right-1.5 top-1.5 flex min-h-9 items-center gap-1 rounded-lg bg-slate-900/75 px-2 text-xs font-semibold text-white"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Убрать
      </button>
    </div>
  )
}

function geoErrorText(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return 'Нет доступа к местоположению — разрешите его в настройках браузера'
  if (err.code === err.TIMEOUT) return 'Не удалось определить место за 20 секунд — попробуйте ещё раз'
  return 'Не удалось определить место'
}

export default function NewCardPage() {
  const user = useAuthStore((s) => s.user)!
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const [photos, setPhotos] = useState<File[]>([])
  const [address, setAddress] = useState('')
  const [districtId, setDistrictId] = useState(user.is_prefecture ? '' : (user.district_id ?? ''))
  const [comment, setComment] = useState('')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [created, setCreated] = useState<CardDetail | null>(null)
  const [failed, setFailed] = useState<File[]>([])

  const { data: districts = [] } = useQuery({
    queryKey: ['districts'],
    queryFn: districtsApi.list,
    enabled: user.is_prefecture,
    staleTime: 10 * 60_000,
  })

  const blocker = submitBlocker({
    canCreate: user.can_create_cards,
    photos: photos.length,
    address,
    needsDistrict: user.is_prefecture,
    districtId,
  })

  const addPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    const good: File[] = []
    for (const file of picked) {
      const problem = photoProblem(file)
      if (problem) notify.error(problem)
      else good.push(file)
    }
    const room = MAX_PHOTOS - photos.length
    if (good.length > room) notify.error(`Не больше ${MAX_PHOTOS} фото ДО в одной карточке`)
    setPhotos((prev) => [...prev, ...good.slice(0, room)])
  }

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('Этот браузер не умеет определять местоположение')
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lon: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy),
        })
        setLocating(false)
      },
      (err) => {
        setGeoError(geoErrorText(err))
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    )
  }

  const uploadAll = async (card: CardDetail, files: File[]) => {
    const stuck: File[] = []
    for (const [i, file] of files.entries()) {
      setBusy(`Загружаем фото ${i + 1} из ${files.length}…`)
      try {
        await uploadWithRetry(() => cardsApi.uploadPhoto(card.id, 'before', file))
      } catch (err) {
        if (isRetryable(err)) stuck.push(file)
        else notify.error(describeError(err, 'Фото не загрузилось'))
      }
    }
    setBusy(null)
    invalidateCardQueries(queryClient, card.id)
    if (stuck.length) {
      setFailed(stuck)
      return
    }
    notify.success(`Нарушение ${card.label} зафиксировано`)
    navigate(`/cards/${card.id}`, { replace: true })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (blocker || busy) return
    setBusy('Сохраняем карточку…')
    let card: CardDetail
    try {
      card = await cardsApi.create({
        address: address.trim(),
        district_id: user.is_prefecture ? districtId : undefined,
        comment: comment.trim() || undefined,
        lat: coords?.lat,
        lon: coords?.lon,
      })
    } catch (err) {
      setBusy(null)
      notify.error(describeError(err, 'Не удалось сохранить карточку'))
      return
    }
    setCreated(card)
    await uploadAll(card, photos)
  }

  if (created && failed.length > 0 && !busy) {
    return (
      <div className="card mx-auto flex max-w-xl flex-col gap-3 p-5" role="alert">
        <h1 className="text-xl font-bold">Карточка {created.label} создана</h1>
        <p className="text-slate-700">
          Не загрузилось фото ДО: {failed.length}. Проверьте связь и отправьте ещё раз — фото сохранены на этом
          экране.
        </p>
        <button type="button" className="btn-primary" onClick={() => void uploadAll(created, failed)}>
          <RotateCcw className="h-5 w-5" aria-hidden />
          Отправить ещё раз
        </button>
        <Link to={`/cards/${created.id}`} className="btn-secondary">
          Открыть карточку
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-2xl flex-col gap-4" noValidate>
      <Link to="/" className="inline-flex min-h-11 w-fit items-center gap-1.5 font-semibold text-brand-600 hover:underline">
        <ArrowLeft className="h-5 w-5" aria-hidden />
        К фотожурналу
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Новое нарушение</h1>

      <section className="card flex flex-col gap-3 p-4">
        <input ref={cameraRef} type="file" accept={PHOTO_ACCEPT} capture="environment" multiple hidden onChange={addPhotos} data-testid="camera-input" />
        <input ref={galleryRef} type="file" accept={PHOTO_ACCEPT} multiple hidden onChange={addPhotos} data-testid="gallery-input" />
        <button
          type="button"
          className="btn-primary min-h-16 text-lg"
          disabled={photos.length >= MAX_PHOTOS || Boolean(busy)}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-6 w-6" aria-hidden />
          {photos.length ? 'Сделать ещё фото ДО' : 'Сделать фото ДО'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={photos.length >= MAX_PHOTOS || Boolean(busy)}
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus className="h-5 w-5" aria-hidden />
          Выбрать из галереи
        </button>
        <p className="text-sm text-slate-500">
          До {MAX_PHOTOS} фото, каждое не больше 20 МБ. Выбрано: {photos.length}
        </p>
        {photos.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((file, i) => (
              <PhotoPreview
                key={`${file.name}-${file.lastModified}-${i}`}
                file={file}
                disabled={Boolean(busy)}
                onRemove={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-4">
        <div>
          <label htmlFor="address" className="label">
            Адрес
          </label>
          <input
            id="address"
            className="field"
            value={address}
            maxLength={500}
            autoComplete="off"
            placeholder="Например: ул. Усиевича, д. 10, у второго подъезда"
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        {user.is_prefecture ? (
          <div>
            <label htmlFor="district" className="label">
              Район
            </label>
            <select id="district" className="field" value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
              <option value="">Выберите район</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="text-[15px]">
            Район: <b>{user.district_name ?? 'не назначен'}</b>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="label mb-0">Место на карте (необязательно)</span>
          {coords ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 ring-1 ring-emerald-200">
                {coords.lat}, {coords.lon} · точность около {coords.accuracy} м
              </span>
              <button type="button" className="btn-secondary" onClick={() => setCoords(null)}>
                <X className="h-4 w-4" aria-hidden />
                Сбросить
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary w-full sm:w-fit" onClick={locate} disabled={locating}>
              <LocateFixed className="h-5 w-5" aria-hidden />
              {locating ? 'Определяем…' : 'Определить место'}
            </button>
          )}
          {geoError && <p className="text-sm text-orange-700">{geoError}</p>}
        </div>

        <div>
          <label htmlFor="comment" className="label">
            Комментарий (необязательно)
          </label>
          <textarea
            id="comment"
            className="field min-h-20"
            value={comment}
            maxLength={1000}
            placeholder="Например: крышка просела, края разрушены"
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </section>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-col gap-2 bg-page/95 px-4 py-3 backdrop-blur md:bottom-0 md:mx-0 md:rounded-2xl md:px-0">
        <button
          type="submit"
          className="btn-primary min-h-14 text-lg shadow-lg disabled:bg-slate-400 disabled:opacity-100"
          disabled={Boolean(blocker) || Boolean(busy)}
        >
          {busy ?? 'Зафиксировать нарушение'}
        </button>
        {blocker && !busy && (
          <p className="text-center text-sm font-semibold text-slate-600" data-testid="submit-reason">
            {blocker}
          </p>
        )}
      </div>
    </form>
  )
}
