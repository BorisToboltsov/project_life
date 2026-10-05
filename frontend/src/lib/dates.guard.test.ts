import { describe, expect, it } from 'vitest'

import { LANGUAGES } from '@/i18n'

import { formatDateTime, isoToDisplay } from './dates'

const sources = import.meta.glob<string>('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Гейт I7: дата в интерфейсе — всегда «день, месяц, год».
describe('порядок частей даты', () => {
  it('в коде нет нативных полей даты: их формат задаёт браузер, а не приложение', () => {
    const native = /type=["'{]+\s*["']?(date|datetime-local|month|week)\b/
    const offenders = Object.entries(sources)
      .filter(([path, code]) => !path.includes('.test.') && native.test(code))
      .map(([path]) => path)

    expect(Object.keys(sources).length).toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })

  it('в поле ввода дата показывается как день/месяц/год', () => {
    // 25 октября: при любом другом порядке строка была бы иной.
    expect(isoToDisplay('2026-10-25')).toBe('25/10/2026')
  })

  it.each(LANGUAGES)('%s: при выводе день стоит перед месяцем', (language) => {
    const text = formatDateTime('2026-10-25T09:00:00Z', language, 'UTC')

    expect(text).toMatch(/^25\b/)
    expect(text).toContain('09:00')
  })
})
