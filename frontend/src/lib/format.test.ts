import { describe, expect, it } from 'vitest'
import { cardLabel, fixedPercent, formatDateTime, formatDays, formatIsoDate, formatPercent } from '@/lib/format'

describe('formatPercent', () => {
  it.each([
    [2, 3, '66,7%'],
    [7, 10, '70%'],
    [0, 0, '—'],
    [0, 4, '0%'],
    [3, 3, '100%'],
    [1, 8, '12,5%'],
    [5, 16, '31,3%'],
    [1, 3, '33,3%'],
  ])('%i из %i → %s', (fixed, detected, expected) => {
    expect(formatPercent(fixed, detected)).toBe(expected)
  })

  it('без выявленных нарушений процента нет', () => {
    expect(fixedPercent(0, 0)).toBeNull()
  })
})

describe('cardLabel', () => {
  it('дополняет номер нулями до трёх знаков и не обрезает больше', () => {
    expect(cardLabel(1)).toBe('ОЛХ-001')
    expect(cardLabel(42)).toBe('ОЛХ-042')
    expect(cardLabel(999)).toBe('ОЛХ-999')
    expect(cardLabel(1000)).toBe('ОЛХ-1000')
  })
})

describe('даты', () => {
  it('показывает время по Москве независимо от пояса телефона', () => {
    // 21:30 UTC — уже следующий день по Москве
    expect(formatDateTime('2026-09-30T21:30:00Z')).toBe('01.10.2026, 00:30')
  })

  it('переводит ISO-дату без сдвига поясов', () => {
    expect(formatIsoDate('2026-09-05')).toBe('05.09.2026')
  })
})

describe('formatDays', () => {
  it.each([
    [2.5, '2,5 дн.'],
    [3, '3 дн.'],
    [0, '0 дн.'],
    [12.3, '12,3 дн.'],
    [null, '—'],
  ])('%s → %s', (value, expected) => {
    expect(formatDays(value)).toBe(expected)
  })
})
