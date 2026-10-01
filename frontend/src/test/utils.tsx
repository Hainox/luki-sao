import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import type { CardDetail, CardListItem, Photo, Territory, User } from '@/types'

export const districtUser: User = {
  id: 'u-1',
  login: 'petrov',
  full_name: 'Петров Пётр',
  role: 'inspector',
  district_id: 'd-aero',
  district_name: 'Аэропорт',
  is_prefecture: false,
  can_create_cards: true,
}

export const prefectureUser: User = {
  id: 'u-admin',
  login: 'prefect',
  full_name: 'Иванова Анна',
  role: 'admin',
  district_id: null,
  district_name: null,
  is_prefecture: true,
  can_create_cards: true,
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', user = districtUser, token = 'token' }: { route?: string; user?: User | null; token?: string } = {},
) {
  if (user) useAuthStore.getState().login(token, user)
  else useAuthStore.getState().logout()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

export function photo(kind: 'before' | 'after', attempt = kind === 'before' ? 0 : 1, id = `${kind}-${attempt}`): Photo {
  return {
    id,
    kind,
    attempt,
    url: `/uploads/${kind}/${id}.jpg`,
    thumbnail_url: `/uploads/thumbs/${id}.jpg`,
    original_url: `/uploads/${kind}/${id}.jpg`,
    uploaded_by: { id: 'u-1', full_name: 'Петров Пётр', login: 'petrov' },
    created_at: '2026-09-30T08:15:00Z',
  }
}

export const dtTerritory: Territory = {
  id: 't-dt-1',
  kind: 'dt',
  name: 'Усиевича ул. 8',
  owner: 'Жилищник Аэропорт',
  category: '3 категория',
  passport_url: 'https://reestr-ogh.mos.ru/ogh/132296151000038',
}

export const odhTerritory: Territory = {
  id: 't-odh-1',
  kind: 'odh',
  name: '1-я Аэропортовская улица',
  owner: 'Жилищник Аэропорт',
  category: '4 категория',
  passport_url: 'https://reestr-ogh.mos.ru/ogh/132061852100001',
}

export function listItem(overrides: Partial<CardListItem> = {}): CardListItem {
  return {
    id: 'card-1',
    number: 1,
    label: 'ОЛХ-001',
    district_id: 'd-aero',
    district_name: 'Аэропорт',
    address: 'Усиевича ул. 8 — у подъезда 2',
    place_kind: 'dt',
    territory: dtTerritory,
    status: 'detected',
    current_attempt: 0,
    created_at: '2026-09-30T08:15:00Z',
    created_by: { id: 'u-1', full_name: 'Петров Пётр', login: 'petrov' },
    status_changed_at: '2026-09-30T08:15:00Z',
    return_comment: null,
    before_photo: photo('before'),
    before_count: 1,
    after_photo: null,
    after_count: 0,
    permissions: { can_add_before: true, can_add_after: true, can_review: false },
    ...overrides,
  }
}

export function cardDetail(overrides: Partial<CardDetail> = {}): CardDetail {
  return {
    ...listItem(),
    lat: null,
    lon: null,
    comment: null,
    accepted_at: null,
    photos: [photo('before')],
    events: [
      {
        id: 'e-1',
        kind: 'created',
        attempt: null,
        comment: null,
        user: { id: 'u-1', full_name: 'Петров Пётр', login: 'petrov' },
        created_at: '2026-09-30T08:15:00Z',
      },
    ],
    ...overrides,
  }
}

/** JWT с нужным сроком: подпись клиент не проверяет, важен только exp. */
export function fakeJwt(expiresInMs: number, sub = 'u-1'): string {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const exp = Math.floor((Date.now() + expiresInMs) / 1000)
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub, role: 'inspector', exp })}.signature`
}

export interface FakeRequest {
  method: string
  /** Путь вместе с query, как его отправил клиент: /api/cards/card-1/photos?kind=after */
  path: string
  auth: string | null
  body: unknown
}

/** Подменяет fetch: запросы идут через настоящий клиент API (src/lib/api.ts),
 *  а отвечает handler — так проверяется вся цепочка 401 → окно входа → повтор. */
export function fakeServer(handler: (req: FakeRequest) => { status: number; body?: unknown }) {
  const requests: FakeRequest[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>
      const req: FakeRequest = {
        method: init.method ?? 'GET',
        path: input,
        auth: headers.Authorization ?? null,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      }
      requests.push(req)
      const { status, body } = handler(req)
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return requests
}

export const expiredReply = { status: 401, body: { detail: 'Сессия истекла — войдите заново' } }

/** Выбор места люка в форме: тип ДТ/ОДХ и объект из справочника района. */
export async function chooseTerritory(
  user: { click: (el: Element) => Promise<void>; type: (el: Element, text: string) => Promise<void> },
  territory: Territory = dtTerritory,
  query = territory.name.split(' ')[0],
) {
  const { screen } = await import('@testing-library/react')
  await user.click(screen.getByRole('button', { name: new RegExp(`^${territory.kind === 'dt' ? 'ДТ' : 'ОДХ'}`) }))
  await user.type(await screen.findByLabelText(/^Найдите/), query)
  await user.click(await screen.findByRole('button', { name: territory.name }))
}
