import { describe, expect, it } from 'vitest'
import { FAQ_TOPICS, filterFaq } from './faq'

describe('FAQ_TOPICS', () => {
  it('у тем уникальные id (на них ведут ссылки /help?topic=...)', () => {
    const ids = FAQ_TOPICS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('у каждого вопроса есть роль, содержательный ответ и уникальная формулировка', () => {
    const questions = new Set<string>()
    for (const topic of FAQ_TOPICS) {
      expect(topic.items.length).toBeGreaterThan(0)
      for (const item of topic.items) {
        expect(item.roles.length).toBeGreaterThan(0)
        expect(item.a.trim().length).toBeGreaterThan(40)
        expect(questions.has(item.q)).toBe(false)
        questions.add(item.q)
      }
    }
  })
})

describe('filterFaq', () => {
  it('без запроса и с «Всем» возвращает все темы', () => {
    expect(filterFaq(FAQ_TOPICS, 'all', '')).toHaveLength(FAQ_TOPICS.length)
  })

  it('району не показывает «Проверку» — она только у префектуры', () => {
    const district = filterFaq(FAQ_TOPICS, 'district', '')
    expect(district.map((t) => t.id)).not.toContain('proverka')
    for (const topic of district) for (const item of topic.items) expect(item.roles).toContain('district')
    expect(filterFaq(FAQ_TOPICS, 'prefecture', '').map((t) => t.id)).toContain('proverka')
  })

  it('ищет по вопросу и ответу без учёта регистра и ё/е, все слова запроса', () => {
    const found = filterFaq(FAQ_TOPICS, 'all', 'ПАРОЛЬ администратор').flatMap((t) => t.items.map((i) => i.q))
    expect(found).toContain('Забыл пароль')
    expect(filterFaq(FAQ_TOPICS, 'all', 'ещё')).toEqual(filterFaq(FAQ_TOPICS, 'all', 'еще'))
    expect(filterFaq(FAQ_TOPICS, 'all', 'пароль несуществующееслово')).toEqual([])
  })
})
