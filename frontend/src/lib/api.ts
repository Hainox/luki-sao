import type {
  CardCreate,
  CardDetail,
  CardList,
  District,
  DistrictSummary,
  DistrictSummaryParams,
  FilterGroup,
  LoginResponse,
  NearbyTerritory,
  Photo,
  PhotoKind,
  ReviewQueue,
  Summary,
  SummaryParams,
  Territory,
  User,
} from '@/types'
import { TOKEN_KEY, useAuthStore, waitForRelogin } from '@/stores/auth'
import { rememberServerTime } from '@/lib/session'

const BASE_URL = '/api'
const DEFAULT_TIMEOUT_MS = 30_000
// Фото уходят по мобильной связи из поля — 30 секунд там часто мало.
export const PHOTO_UPLOAD_TIMEOUT_MS = 90_000

type Params = Record<string, string | number | boolean | null | undefined>

interface RequestConfig {
  params?: Params
  timeout?: number
  responseType?: 'json' | 'blob'
  /** Без токена: 401 тут — ответ по существу (неверный пароль), а не истёкший вход. */
  anonymous?: boolean
}

// Ошибка с тем же контрактом, что и в журнале обходов: сеть/таймаут —
// в code, HTTP-ошибка — в response.status/response.data.
export class ApiError extends Error {
  code?: 'ECONNABORTED' | 'ERR_NETWORK'
  response?: { status: number; data: unknown }

  constructor(message: string, init: { code?: ApiError['code']; response?: ApiError['response'] } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = init.code
    this.response = init.response
  }
}

function buildQuery(params?: Params): string {
  if (!params) return ''
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    qs.append(key, String(value))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, url: string, body?: unknown, config: RequestConfig = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeout ?? DEFAULT_TIMEOUT_MS)
  const headers: Record<string, string> = {}
  const token = config.anonymous ? null : localStorage.getItem(TOKEN_KEY)
  if (token) headers.Authorization = `Bearer ${token}`

  let payload: BodyInit | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    payload = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }

  try {
    const res = await fetch(BASE_URL + url + buildQuery(config.params), {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    })
    rememberServerTime(res.headers.get('Date'))
    if (!res.ok) {
      const text = await res.text()
      let data: unknown = text
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        // тело не JSON — оставляем текстом
      }
      // Вход истёк — не уводим на /login: переход стёр бы выбранные, но ещё
      // не отправленные фото и заполненную форму. Поверх страницы откроется
      // окно повторного входа (ReloginDialog), запрос повторят после него.
      // Если токен сменился, пока шёл запрос, — входить заново не нужно.
      if (res.status === 401 && token && localStorage.getItem(TOKEN_KEY) === token) {
        useAuthStore.getState().expire()
      }
      throw new ApiError(`HTTP ${res.status}`, { response: { status: res.status, data } })
    }
    if (config.responseType === 'blob') return (await res.blob()) as T
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('timeout', { code: 'ECONNABORTED' })
    }
    throw new ApiError('network', { code: 'ERR_NETWORK' })
  } finally {
    clearTimeout(timer)
  }
}

function detailOf(error: unknown): string {
  if (!(error instanceof ApiError) || !error.response) return ''
  const data = error.response.data as { detail?: unknown } | null
  return typeof data?.detail === 'string' ? data.detail : ''
}

// Человекочитаемая причина: «нет связи» и «сервер отказал» требуют от
// сотрудника в поле разных действий.
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'ECONNABORTED') return 'Превышено время ожидания — проверьте связь и попробуйте ещё раз'
    if (!error.response) return 'Нет соединения с сервером — проверьте интернет'
    if (error.response.status === 413) return 'Файл слишком большой для сервера'
    const detail = detailOf(error)
    if (detail) return detail
  }
  return fallback
}

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  if (!error.response) return true
  return error.response.status >= 500 || error.response.status === 429
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.response?.status === 401
}

/** Запрос ждал повторного входа, а сотрудник вместо этого вышел. */
export class LoggedOutError extends Error {
  constructor() {
    super('logged out')
    this.name = 'LoggedOutError'
  }
}

/** Запрос, который переживает истёкший вход: на 401 ждёт повторного входа
 *  поверх страницы и отправляет то же самое ещё раз. Сервер на 401 ничего не
 *  сохраняет, так что повтор не задвоит ни карточку, ни фото. beforeResume —
 *  проверка перед повтором (пока ждали входа, карточка могла измениться);
 *  её ошибка завершает запрос. Вышел вместо входа — LoggedOutError. */
export async function retryAfterRelogin<T>(send: () => Promise<T>, beforeResume?: () => Promise<void>): Promise<T> {
  for (;;) {
    const token = useAuthStore.getState().token
    try {
      return await send()
    } catch (err) {
      if (!isUnauthorized(err)) throw err
      const state = useAuthStore.getState()
      if (state.token === token) {
        if (state.relogin !== 'expired') throw err
        if (!(await waitForRelogin())) throw new LoggedOutError()
      } else if (!state.token) {
        throw new LoggedOutError()
      }
      // Иначе токен сменился, пока шёл запрос (уже вошли заново), — повторяем с новым.
      await beforeResume?.()
    }
  }
}

export const authApi = {
  login: (login: string, password: string) =>
    request<LoginResponse>('POST', '/auth/login', { login, password }, { anonymous: true }),
  me: () => request<User>('GET', '/auth/me'),
}

export const districtsApi = {
  list: () => request<District[]>('GET', '/districts'),
}

export interface CardListParams extends SummaryParams {
  district_id?: string
  filter?: FilterGroup
  page?: number
  page_size?: number
}

export const cardsApi = {
  list: (params: CardListParams) => request<CardList>('GET', '/cards', undefined, { params: { ...params } }),
  get: (id: string) => request<CardDetail>('GET', `/cards/${id}`),
  create: (data: CardCreate) => request<CardDetail>('POST', '/cards', data),
  uploadPhoto: (id: string, kind: PhotoKind, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Photo>('POST', `/cards/${id}/photos`, form, {
      params: { kind },
      timeout: PHOTO_UPLOAD_TIMEOUT_MS,
    })
  },
  reviewQueue: () => request<ReviewQueue>('GET', '/cards/review-queue'),
  accept: (id: string) => request<CardDetail>('POST', `/cards/${id}/accept`),
  returnForRework: (id: string, comment: string) =>
    request<CardDetail>('POST', `/cards/${id}/return`, { comment }),
}

export const territoriesApi = {
  /** Все ДТ и ОДХ района: префектура передаёт район, сотруднику сервер берёт его район. */
  list: (districtId?: string) =>
    request<Territory[]>('GET', '/territories', undefined, { params: { district_id: districtId || undefined } }),
  nearby: (lat: number, lon: number, districtId?: string) =>
    request<NearbyTerritory[]>('GET', '/territories/nearby', undefined, {
      params: { lat, lon, district_id: districtId || undefined },
    }),
}

export const summaryApi = {
  /** Таблица по всем районам — только префектуре. */
  get: (params: SummaryParams) => request<Summary>('GET', '/summary', undefined, { params: { ...params } }),
  xlsx: (params: SummaryParams) =>
    request<Blob>('GET', '/summary.xlsx', undefined, { params: { ...params }, responseType: 'blob' }),
  district: (params: DistrictSummaryParams) =>
    request<DistrictSummary>('GET', '/summary/district', undefined, { params: { ...params } }),
  districtXlsx: (params: DistrictSummaryParams) =>
    request<Blob>('GET', '/summary/district.xlsx', undefined, { params: { ...params }, responseType: 'blob' }),
}
