import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import type { CardDetail, CardListItem, Photo, User } from '@/types'

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

export function renderWithProviders(ui: ReactElement, { route = '/', user = districtUser }: { route?: string; user?: User | null } = {}) {
  useAuthStore.setState({ token: user ? 'token' : null, user })
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

export function listItem(overrides: Partial<CardListItem> = {}): CardListItem {
  return {
    id: 'card-1',
    number: 1,
    label: 'ОЛХ-001',
    district_id: 'd-aero',
    district_name: 'Аэропорт',
    address: 'ул. Усиевича, д. 10',
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
