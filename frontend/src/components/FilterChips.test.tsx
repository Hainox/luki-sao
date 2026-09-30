import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterChips } from '@/components/FilterChips'

describe('FilterChips', () => {
  it('показывает четыре фильтра со счётчиками и отмечает выбранный', async () => {
    const onChange = vi.fn()
    render(<FilterChips value="open" counts={{ all: 12, open: 4, on_review: 3, accepted: 5 }} onChange={onChange} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Все12',
      'Выявлено (Не исправлено)4',
      'На проверке3',
      'Исправлено (Принято)5',
    ])
    expect(screen.getByRole('button', { name: /Выявлено \(Не исправлено\)/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Все/ })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(screen.getByRole('button', { name: /На проверке/ }))
    expect(onChange).toHaveBeenCalledWith('on_review')
  })

  it('пока счётчики грузятся, показывает многоточие', () => {
    render(<FilterChips value="all" onChange={() => {}} />)
    expect(screen.getByTestId('count-all')).toHaveTextContent('…')
  })
})
