import { describe, expect, it } from 'vitest'

import { numberIn, numberOf, optionalNumberIn, optionalNumberOf } from './validation'

describe('numberOf', () => {
  it('понимает запятую и округляет до точности сервера', () => {
    expect(numberOf('12,345', 2)).toBe(12.35)
    expect(numberOf('149.96', 1)).toBe(150)
    expect(numberOf('2100', 0)).toBe(2100)
  })
})

describe('optionalNumberOf', () => {
  it('пустое поле — нет значения, заполненное — число', () => {
    expect(optionalNumberOf('', 0)).toBeNull()
    expect(optionalNumberOf('   ', 0)).toBeNull()
    expect(optionalNumberOf('0', 0)).toBe(0)
    expect(optionalNumberOf('130,4', 0)).toBe(130)
  })
})

describe('optionalNumberIn', () => {
  const schema = optionalNumberIn(500, 10000, 'validation.goalKcalRange')

  it.each(['', '  ', '500', '10000', '2100,5'])('принимает «%s»', (text) => {
    expect(schema.safeParse(text).success).toBe(true)
  })

  it.each(['499', '10001', 'много', '-'])('отклоняет «%s» ключом словаря', (text) => {
    const result = schema.safeParse(text)

    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['validation.goalKcalRange'])
  })
})

describe('numberIn', () => {
  const schema = numberIn(0.1, 5000, 'validation.amountRange')

  it('принимает число в границах с запятой или точкой', () => {
    expect(schema.safeParse('0,1').success).toBe(true)
    expect(schema.safeParse(' 5000 ').success).toBe(true)
  })

  it.each(['', 'много', '0,05', '5000.1'])('отклоняет «%s» ключом словаря', (text) => {
    const result = schema.safeParse(text)

    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['validation.amountRange'])
  })
})
