// Вне src: тесту нужен node:fs, а типы node в сборку приложения не входят.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FAQ_TOPICS } from '../src/lib/faq'

const ROOT = join(import.meta.dirname, '..', '..')

// Подписи чужого интерфейса: системные меню телефона и журнал обходов.
const EXTERNAL_LABELS = new Set([
  'Поделиться',
  'На экран „Домой“',
  'Установить приложение',
  'Добавить на главный экран',
  'Ещё',
  'Проблема в приложении',
])

function sources(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '__pycache__' ? [] : sources(path, exts)
    return exts.some((e) => name.endsWith(e)) && !name.includes('.test.') && name !== 'faq.ts' ? [path] : []
  })
}

const appText = [
  ...sources(join(ROOT, 'frontend', 'src'), ['.ts', '.tsx']),
  ...sources(join(ROOT, 'backend', 'app'), ['.py']),
]
  .map((path) => readFileSync(path, 'utf-8'))
  .join('\n')

describe('подписи в ответах «Помощи»', () => {
  // «Сначала смените пароль…» — начало сообщения, «Вернули: …» — шаблон.
  const quotes = FAQ_TOPICS.flatMap((t) => t.items).flatMap((item) =>
    [...`${item.q} ${item.a}`.matchAll(/«([^«»]*)»/g)].map((m) => m[1].replace(/\s*…$/, '')),
  )

  it('в ответах есть что проверять', () => {
    expect(quotes.length).toBeGreaterThan(30)
  })

  it.each([...new Set(quotes)].filter((q) => !EXTERNAL_LABELS.has(q)))('«%s» есть в приложении', (label) => {
    expect(appText.includes(label)).toBe(true)
  })
})
