import { describe, expect, it } from 'vitest'

import { formatDelta, formatNumber, formatYears, parseDecimal } from './numbers'

describe('parseDecimal', () => {
  it.each([
    ['72', 72],
    ['72.4', 72.4],
    ['72,4', 72.4],
    [' 72,4 ', 72.4],
    ['0,5', 0.5],
  ])('«%s» → %s', (text, expected) => {
    expect(parseDecimal(text)).toBe(expected)
  })

  it.each(['', ' ', 'семьдесят', '72,4,1', '72.', ',5', '-3', '7e2', '72 кг'])(
    '«%s» — не число',
    (text) => {
      expect(parseDecimal(text)).toBeNull()
    },
  )
})

describe('числа в записи языка', () => {
  it('десятичная запятая по-русски, точка по-английски', () => {
    expect(formatNumber(72.4, 'ru')).toBe('72,4')
    expect(formatNumber(72.4, 'en')).toBe('72.4')
  })

  it('не больше одного знака после разделителя, лишние нули не пишутся', () => {
    expect(formatNumber(72.449, 'en')).toBe('72.4')
    expect(formatNumber(72, 'en')).toBe('72')
  })

  it.each([
    [1, 'ru', '1 год'],
    [22, 'ru', '22 года'],
    [36, 'ru', '36 лет'],
    [111, 'ru', '111 лет'],
    [1, 'en', '1 year'],
    [36, 'en', '36 years'],
  ])('%s в «%s» — «%s»: число лет согласовано со словом', (value, language, expected) => {
    expect(formatYears(value, language)).toBe(expected)
  })

  it('изменение показывается со знаком', () => {
    expect(formatDelta(0.4, 'en')).toBe('+0.4')
    expect(formatDelta(-0.4, 'ru')).toBe('-0,4')
    expect(formatDelta(0, 'en')).toBe('0')
  })
})
