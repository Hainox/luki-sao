export type Role = 'inspector' | 'reviewer' | 'admin'

export interface User {
  id: string
  login: string
  full_name: string
  role: Role
  district_id: string | null
  district_name: string | null
  is_prefecture: boolean
  can_create_cards: boolean
}

export interface LoginResponse {
  access_token: string
  user: User
}

export interface District {
  id: string
  name: string
}

export type CardStatus = 'detected' | 'on_review' | 'accepted' | 'returned'
export type FilterGroup = 'all' | 'open' | 'on_review' | 'accepted'
export type PeriodKind = 'all' | 'today' | 'week' | 'month' | 'custom'
export type PhotoKind = 'before' | 'after'

export interface Person {
  id: string
  full_name: string
  login: string
}

export interface Photo {
  id: string
  kind: PhotoKind
  attempt: number
  url: string
  thumbnail_url: string
  original_url: string
  uploaded_by: Person
  created_at: string
}

export interface CardEvent {
  id: string
  kind: 'created' | 'after_uploaded' | 'accepted' | 'returned'
  attempt: number | null
  comment: string | null
  user: Person
  created_at: string
}

export interface CardPermissions {
  can_add_before: boolean
  can_add_after: boolean
  can_review: boolean
}

export interface CardListItem {
  id: string
  number: number
  label: string
  district_id: string
  district_name: string
  address: string
  status: CardStatus
  current_attempt: number
  created_at: string
  created_by: Person
  status_changed_at: string
  return_comment: string | null
  before_photo: Photo | null
  before_count: number
  after_photo: Photo | null
  after_count: number
  permissions: CardPermissions
}

export interface CardDetail extends CardListItem {
  lat: string | null
  lon: string | null
  comment: string | null
  accepted_at: string | null
  photos: Photo[]
  events: CardEvent[]
}

export interface FilterCounts {
  all: number
  open: number
  on_review: number
  accepted: number
}

export interface PeriodInfo {
  kind: PeriodKind
  date_from: string | null
  date_to: string | null
  label: string
}

export interface CardList {
  items: CardListItem[]
  total: number
  page: number
  page_size: number
  counts: FilterCounts
  period: PeriodInfo
}

export interface ReviewQueue {
  items: CardDetail[]
  total: number
}

export interface SummaryRow {
  district_id: string | null
  district_name: string
  detected: number
  fixed: number
  on_review: number
  percent: string | null
  percent_label: string
}

export interface Summary {
  period: PeriodInfo
  rows: SummaryRow[]
  total: SummaryRow
}

export interface PeriodParams {
  period: PeriodKind
  date_from?: string
  date_to?: string
}

export interface CardCreate {
  id: string
  district_id?: string
  address: string
  lat?: number
  lon?: number
  comment?: string
}
