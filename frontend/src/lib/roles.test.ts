import { describe, expect, it } from 'vitest'
import { hasNoJournal, roleLabel } from '@/lib/roles'
import { districtUser, prefectureUser } from '@/test/utils'

const noDistrict = { ...districtUser, district_id: null, district_name: null, can_create_cards: false }

describe('roles', () => {
  it('без района нет ни журнала, ни свода — и у инспектора, и у проверяющего', () => {
    expect(hasNoJournal(noDistrict)).toBe(true)
    expect(hasNoJournal({ ...noDistrict, role: 'reviewer' })).toBe(true)
    expect(hasNoJournal(districtUser)).toBe(false)
    expect(hasNoJournal({ ...districtUser, role: 'reviewer' })).toBe(false)
    expect(hasNoJournal(prefectureUser)).toBe(false)
  })

  it('подпись роли', () => {
    expect(roleLabel(prefectureUser)).toBe('Префектура')
    expect(roleLabel(districtUser)).toBe('Район: Аэропорт')
    expect(roleLabel({ ...noDistrict, role: 'reviewer' })).toBe('Район не назначен')
    expect(roleLabel(noDistrict)).toBe('Район не назначен')
  })
})
