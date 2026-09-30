import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { CardRow } from '@/components/CardRow'
import { listItem, photo, renderWithProviders } from '@/test/utils'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, cardsApi: { ...actual.cardsApi, uploadPhoto: vi.fn() } }
})

describe('CardRow', () => {
  it('до исправления: фото ДО и пустая ячейка ПОСЛЕ с кнопкой для района', () => {
    renderWithProviders(<CardRow card={listItem()} />)
    const row = screen.getByTestId('card-row')
    expect(within(row).getByText('ОЛХ-001')).toBeInTheDocument()
    expect(within(row).getByText('Район: Аэропорт')).toBeInTheDocument()
    expect(within(row).getByAltText('Фото ДО')).toHaveAttribute('src', '/uploads/thumbs/before-0.jpg')
    expect(within(row).queryByAltText('Фото ПОСЛЕ')).not.toBeInTheDocument()
    expect(within(row).getByText('Ожидает исправления')).toBeInTheDocument()
    expect(within(row).getByText('После устранения нарушения добавьте фотографию')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Добавить фото ПОСЛЕ/ })).toBeInTheDocument()
    expect(within(row).getAllByText('Выявлено').length).toBeGreaterThan(0)
    expect(within(row).getByText('Нарушение зафиксировано')).toBeInTheDocument()
  })

  it('без права исправлять кнопки «Добавить фото ПОСЛЕ» нет', () => {
    renderWithProviders(
      <CardRow card={listItem({ permissions: { can_add_before: false, can_add_after: false, can_review: false } })} />,
    )
    expect(screen.getByText('Ожидает исправления')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Добавить фото ПОСЛЕ/ })).not.toBeInTheDocument()
  })

  it('на проверке: показывает фото ПОСЛЕ и строку проверки', () => {
    renderWithProviders(
      <CardRow card={listItem({ status: 'on_review', current_attempt: 1, after_photo: photo('after'), after_count: 2 })} />,
    )
    expect(screen.getByAltText('Фото ПОСЛЕ')).toHaveAttribute('src', '/uploads/thumbs/after-1.jpg')
    expect(screen.getByText('ещё 1')).toBeInTheDocument()
    expect(screen.queryByText('Ожидает исправления')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Добавить фото ПОСЛЕ/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('На проверке').length).toBeGreaterThan(0)
    expect(screen.getByText('Проверка префектурой')).toBeInTheDocument()
  })

  it('возвращённая: отклонённое фото скрыто, просим новое и показываем комментарий', () => {
    renderWithProviders(
      <CardRow
        card={listItem({
          status: 'returned',
          current_attempt: 1,
          after_photo: photo('after'),
          after_count: 1,
          return_comment: 'Крышка не закреплена',
        })}
      />,
    )
    expect(screen.queryByAltText('Фото ПОСЛЕ')).not.toBeInTheDocument()
    expect(screen.getByText('Ожидает повторного исправления')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Добавить новое фото ПОСЛЕ/ })).toBeInTheDocument()
    expect(screen.getAllByText('Возвращено').length).toBeGreaterThan(0)
    expect(screen.getByText('Вернули: Крышка не закреплена')).toBeInTheDocument()
  })

  it('принятая: зелёный статус и строка приёмки', () => {
    renderWithProviders(
      <CardRow
        card={listItem({
          status: 'accepted',
          current_attempt: 1,
          after_photo: photo('after'),
          after_count: 1,
          permissions: { can_add_before: false, can_add_after: false, can_review: false },
        })}
      />,
    )
    expect(screen.getAllByText('Принято').length).toBeGreaterThan(0)
    expect(screen.getByText('Принято префектурой')).toBeInTheDocument()
    expect(screen.getByAltText('Фото ПОСЛЕ')).toBeInTheDocument()
  })

  it('без фото ДО показывает понятную пустую ячейку', () => {
    renderWithProviders(<CardRow card={listItem({ before_photo: null, before_count: 0 })} />)
    expect(screen.getByText('Фото ДО не загружено')).toBeInTheDocument()
  })
})
