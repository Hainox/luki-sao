import type {
  CardCreate,
  CardDetail,
  CardList,
  District,
  FilterGroup,
  LoginResponse,
  PeriodParams,
  Photo,
  PhotoKind,
  ReviewQueue,
  Summary,
  User,
} from '@/types'

const BASE_URL = '/api'
const DEFAULT_TIMEOUT_MS = 30_000
// Фото уходят по мобильной связи из поля — 30 секунд там часто мало.
export const PHOTO_UPLOAD_TIMEOUT_MS = 90_000

export const TOKEN_KEY = 'luki_token'
export const USER_KEY = 'luki_user'

type Params = Record<string, string | number | boolean | null | undefined>

interface RequestConfig {
  params?: Params
  timeout?: number
  responseType?: 'json' | 'blob'
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

function handleUnauthorized() {
  if (window.location.pathname === '/login') return
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  window.location.href = '/login'
}

async function request<T>(method: string, url: string, body?: unknown, config: RequestConfig = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeout ?? DEFAULT_TIMEOUT_MS)
  const headers: Record<string, string> = {}
  const token = localStorage.getItem(TOKEN_KEY)
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
    if (!res.ok) {
      const text = await res.text()
      let data: unknown = text
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        // тело не JSON — оставляем текстом
      }
      if (res.status === 401) handleUnauthorized()
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

export const authApi = {
  login: (login: string, password: string) =>
    request<LoginResponse>('POST', '/auth/login', { login, password }),
  me: () => request<User>('GET', '/auth/me'),
}

export const districtsApi = {
  list: () => request<District[]>('GET', '/districts'),
}

export interface CardListParams extends PeriodParams {
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

export const summaryApi = {
  get: (params: PeriodParams) => request<Summary>('GET', '/summary', undefined, { params: { ...params } }),
  xlsx: (params: PeriodParams) =>
    request<Blob>('GET', '/summary.xlsx', undefined, { params: { ...params }, responseType: 'blob' }),
}
