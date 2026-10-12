import { describe, expect, it } from 'vitest'

import { cottageCheese, egg } from '@/test/fixtures'

import { portionsAmount, sizesOf } from './portions'

describe('portionsAmount', () => {
  it.each([
    [2, 60, 120],
    [1.5, 60, 90],
    [0.25, 60, 15],
    [1, 5000, 5000],
    // Треть упаковки: количество хранится до десятой.
    [0.33, 200, 66],
    // Половина округляется вверх, как на сервере, — и без погрешности дробных чисел.
    [0.5, 33.3, 16.7],
    [0.25, 0.1, 0],
  ])('%s × %s = %s', (count, size, amount) => {
    expect(portionsAmount(count, size)).toBe(amount)
  })
})

describe('sizesOf', () => {
  it('называет только те меры, что есть у продукта', () => {
    expect(sizesOf(egg)).toEqual({ serving: 60, package: 600 })
    expect(sizesOf({ ...egg, serving_size: null })).toEqual({ package: 600 })
    expect(sizesOf(cottageCheese)).toEqual({})
  })
})
