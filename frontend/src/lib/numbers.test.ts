import { describe, expect, it } from 'vitest'

import { formatDelta, formatNumber, parseDecimal } from './numbers'

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

  it('изменение показывается со знаком', () => {
    expect(formatDelta(0.4, 'en')).toBe('+0.4')
    expect(formatDelta(-0.4, 'ru')).toBe('-0,4')
    expect(formatDelta(0, 'en')).toBe('0')
  })
})
