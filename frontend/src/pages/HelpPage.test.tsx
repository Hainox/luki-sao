import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import HelpRoute from '@/pages/HelpPage'
import { districtUser, fakeServer, prefectureUser, renderWithProviders } from '@/test/utils'

const topicButton = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) })

describe('HelpPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('без входа открывается отдельной страницей с «Всем» и ссылкой ко входу', () => {
    renderWithProviders(<HelpRoute />, { route: '/help', user: null })
    expect(screen.getByRole('heading', { name: 'Помощь' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Всем' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /Ко входу/ })).toHaveAttribute('href', '/login')
    expect(topicButton('Проверка')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).not.toBeInTheDocument()
  })

  it('сотруднику района — его вопросы, без темы «Проверка», внутри обычного меню', () => {
    renderWithProviders(<HelpRoute />, { route: '/help' })
    expect(screen.getByRole('button', { name: 'Район' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /^Проверка/ })).not.toBeInTheDocument()
    const nav = screen.getAllByRole('navigation', { name: 'Разделы' })[0]
    expect(within(nav).getByRole('link', { name: 'Помощь' })).toHaveAttribute('href', '/help')
  })

  it('префектуре по умолчанию — её вопросы, тема «Проверка» есть', () => {
    fakeServer(() => ({ status: 200, body: { items: [], total: 0 } }))
    renderWithProviders(<HelpRoute />, { route: '/help', user: prefectureUser })
    expect(screen.getByRole('button', { name: 'Префектура' })).toHaveAttribute('aria-pressed', 'true')
    expect(topicButton('Проверка')).toBeInTheDocument()
  })

  it('ссылка на тему префектуры у района открывает её, а не пустую страницу', () => {
    renderWithProviders(<HelpRoute />, { route: '/help?topic=proverka', user: districtUser })
    expect(screen.getByRole('button', { name: 'Всем' })).toHaveAttribute('aria-pressed', 'true')
    expect(topicButton('Проверка')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Как проверять исправления?' })).toBeInTheDocument()
  })

  it('раскрывает тему и ответ по нажатию', async () => {
    const user = userEvent.setup()
    renderWithProviders(<HelpRoute />, { route: '/help', user: null })
    await user.click(topicButton('Вход'))
    const question = screen.getByRole('button', { name: 'Забыл пароль' })
    expect(question).toHaveAttribute('aria-expanded', 'false')
    await user.click(question)
    expect(question).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/сбросить его может только администратор журнала обходов/)).toBeInTheDocument()
  })

  it('поиск раскрывает найденные темы, а без совпадений предлагает поддержку', async () => {
    const user = userEvent.setup()
    renderWithProviders(<HelpRoute />, { route: '/help', user: null })
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по вопросам' }), 'excel')
    expect(screen.getByRole('button', { name: 'Как выгрузить свод в Excel?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Вход/ })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Поиск по вопросам' }))
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по вопросам' }), 'абракадабра')
    expect(screen.getByRole('status')).toHaveTextContent('Ничего не нашлось')
    expect(screen.getByRole('link', { name: 'Написать в поддержку' })).toHaveAttribute('href', 'https://obhod-sao.ru/feedback')
  })

  it('со страницы входа ведёт ссылка на тему «Вход»', async () => {
    const user = userEvent.setup()
    renderWithProviders(<App />, { route: '/login', user: null })
    await user.click(screen.getByRole('link', { name: 'Не получается войти? Помощь' }))
    expect(screen.getByRole('heading', { name: 'Помощь' })).toBeInTheDocument()
    expect(topicButton('Вход')).toHaveAttribute('aria-expanded', 'true')
  })
})
