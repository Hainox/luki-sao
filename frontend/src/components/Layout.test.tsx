import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import Layout from '@/components/Layout'
import { cardsApi } from '@/lib/api'
import { districtUser, prefectureUser, renderWithProviders } from '@/test/utils'
import type { User } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, cardsApi: { ...actual.cardsApi, reviewQueue: vi.fn() } }
})

const navNames = () => screen.queryAllByRole('link').map((l) => l.textContent)

describe('Layout: разделы по роли', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cardsApi.reviewQueue).mockResolvedValue({ items: [], total: 0 })
  })

  it('сотрудник района видит фотожурнал, свод и помощь', () => {
    renderWithProviders(<Layout />, { user: districtUser })
    expect(screen.getAllByRole('link', { name: 'Свод' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Помощь' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Фотожурнал' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Проверка' })).not.toBeInTheDocument()
  })

  it('префектура видит ещё и проверку', () => {
    renderWithProviders(<Layout />, { user: prefectureUser })
    expect(screen.getAllByRole('link', { name: 'Проверка' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Свод' }).length).toBeGreaterThan(0)
  })

  it.each(['inspector', 'reviewer'] as const)('без района (%s) — ни свода, ни журнала в меню, только «Помощь»', (role) => {
    const user: User = { ...districtUser, role, district_id: null, district_name: null, can_create_cards: false }
    renderWithProviders(<Layout />, { user })
    expect(navNames()).not.toContain('Свод')
    expect(navNames()).not.toContain('Фотожурнал')
    expect(screen.getAllByRole('link', { name: 'Помощь' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Район не назначен').length).toBeGreaterThan(0)
  })
})
