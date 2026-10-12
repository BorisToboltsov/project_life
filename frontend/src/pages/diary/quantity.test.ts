import { describe, expect, it } from 'vitest'

import type { AmountMode } from '@/lib/portions'
import { cottageCheese, egg, suggestionOf } from '@/test/fixtures'

import {
  entered,
  firstQuantity,
  howMuch,
  quantityOf,
  quantitySchema,
  switched,
  unitsOf,
} from './quantity'

const SIZES = { serving: 60, package: 600 }

function issues(mode: AmountMode, amount: string, sizes = SIZES) {
  const result = quantitySchema(sizes).safeParse({ mode, amount })
  return result.success ? [] : result.error.issues.map((issue) => [issue.path, issue.message])
}

describe('quantitySchema', () => {
  it.each(['150', '0,1', '5000', ' 62.5 '])('в единицах продукта принимает %s', (amount) => {
    expect(issues('unit', amount)).toEqual([])
  })

  it.each(['', '0', '0,05', '5000,1', '-5', 'много'])(
    'в единицах продукта отклоняет «%s»',
    (amount) => {
      expect(issues('unit', amount)).toEqual([[['amount'], 'validation.amountRange']])
    },
  )

  it.each([
    ['serving', '2'],
    ['serving', '0,5'],
    ['serving', '83'],
    ['package', '0.01'],
    ['package', '8,33'],
  ] as const)('порциями принимает %s × %s', (mode, amount) => {
    expect(issues(mode, amount)).toEqual([])
  })

  it.each(['', '0', '0,001', '100,5', '-1', 'пара'])('отклоняет число порций «%s»', (amount) => {
    expect(issues('serving', amount)).toEqual([[['amount'], 'validation.portionCountRange']])
  })

  it('число порций в порядке, а количество — нет', () => {
    // 84 порции по 60 г — больше пяти килограммов.
    expect(issues('serving', '84')).toEqual([[['amount'], 'validation.portionsAmount']])
    expect(issues('package', '9')).toEqual([[['amount'], 'validation.portionsAmount']])
    // Сотая доля грамма в записи — ноль.
    expect(issues('serving', '0,01', { serving: 1, package: 600 })).toEqual([
      [['amount'], 'validation.portionsAmount'],
    ])
  })

  it('меры, которой у продукта нет, не бывает', () => {
    expect(issues('package', '1', { serving: 60 } as typeof SIZES)).toEqual([
      [['amount'], 'validation.portionsAmount'],
    ])
  })
})

describe('количество для запроса и для записи', () => {
  it('в единицах продукта уходит числом до десятой', () => {
    expect(howMuch({ mode: 'unit', amount: '62,54' })).toEqual({ amount: 62.5 })
    expect(entered({ mode: 'unit', amount: '62,54' }, SIZES)).toEqual({
      amount: 62.5,
      portion: null,
    })
  })

  it('порциями уходит видом и числом до сотой — единицы посчитает сервер', () => {
    expect(howMuch({ mode: 'serving', amount: '1,5' })).toEqual({
      portion: { kind: 'serving', count: 1.5 },
    })
    expect(entered({ mode: 'package', amount: '0,333' }, SIZES)).toEqual({
      amount: 198,
      portion: { kind: 'package', count: 0.33 },
    })
  })

  it('набранное переводится в единицы продукта', () => {
    expect(unitsOf({ mode: 'unit', amount: '120' }, SIZES)).toBe(120)
    expect(unitsOf({ mode: 'serving', amount: '2' }, SIZES)).toBe(120)
    expect(unitsOf({ mode: 'serving', amount: 'два' }, SIZES)).toBeNull()
    expect(unitsOf({ mode: 'package', amount: '1' }, { serving: 60 })).toBeNull()
  })
})

describe('с чего начинается поле', () => {
  it('незнакомый продукт с порцией — одна порция, без неё — сто единиц', () => {
    expect(firstQuantity(egg)).toEqual({ mode: 'serving', amount: '1' })
    expect(firstQuantity({ ...egg, serving_size: null })).toEqual({ mode: 'unit', amount: '100' })
    expect(firstQuantity(cottageCheese)).toEqual({ mode: 'unit', amount: '100' })
  })

  it('знакомый — как в прошлый раз', () => {
    expect(quantityOf(suggestionOf(cottageCheese, 180))).toEqual({ mode: 'unit', amount: '180' })
    expect(quantityOf(suggestionOf(egg, 300, { kind: 'package', size: 600, count: 0.5 }))).toEqual({
      mode: 'package',
      amount: '0.5',
    })
  })
})

describe('switched', () => {
  const from = (mode: AmountMode, amount: string) => ({ mode, amount })

  it('в единицы продукта переводит всегда', () => {
    expect(switched(from('serving', '2'), 'unit', SIZES, true)).toBe('120')
    expect(switched(from('package', '0,5'), 'unit', SIZES, false)).toBe('300')
    // Не число переводить не во что.
    expect(switched(from('serving', 'два'), 'unit', SIZES, true)).toBe('два')
  })

  it('в порции переводит то, что выражается в них ровно', () => {
    expect(switched(from('unit', '120'), 'serving', SIZES, true)).toBe('2')
    expect(switched(from('unit', '90'), 'serving', SIZES, false)).toBe('1.5')
    expect(switched(from('serving', '10'), 'package', SIZES, false)).toBe('1')
    expect(switched(from('package', '0,5'), 'serving', SIZES, true)).toBe('5')
    expect(switched(from('serving', '2'), 'package', SIZES, false)).toBe('0.2')
  })

  it('что ровно не выражается: набранное остаётся, подсказка становится одной порцией', () => {
    // Человек набрал «2», думая о порциях, и только потом выбрал меру.
    expect(switched(from('unit', '2'), 'serving', SIZES, true)).toBe('2')
    // А «100» стояло в поле само.
    expect(switched(from('unit', '100'), 'serving', SIZES, false)).toBe('1')
    expect(switched(from('unit', ''), 'package', SIZES, false)).toBe('1')
    expect(switched(from('unit', '7000'), 'serving', SIZES, true)).toBe('7000')
  })
})
