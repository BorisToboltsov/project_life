import { describe, expect, it } from 'vitest'

import { cottageCheese } from '@/test/fixtures'

import { productDefaults, productSchema } from './productValues'

function issues(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((issue) => issue.message)
}

describe('productSchema', () => {
  const valid = productDefaults(cottageCheese)

  it('принимает продукт из каталога как есть', () => {
    expect(valid).toEqual({
      name: 'Творог 5 %',
      kcal: '121',
      protein: '17.2',
      fat: '5',
      carbs: '1.8',
    })
    expect(productSchema.safeParse(valid).success).toBe(true)
  })

  it('пустая форма для нового продукта не проходит', () => {
    expect(issues(productSchema.safeParse(productDefaults()))).toEqual([
      'validation.required',
      'validation.kcalRange',
      'validation.macroRange',
      'validation.macroRange',
      'validation.macroRange',
    ])
  })

  it.each([
    [{ name: 'я'.repeat(121) }, 'validation.productName'],
    [{ kcal: '900,1' }, 'validation.kcalRange'],
    [{ fat: '100,5' }, 'validation.macroRange'],
    [{ protein: '40', fat: '40', carbs: '20,5' }, 'validation.macroSum'],
  ])('отклоняет %o', (fields, message) => {
    expect(issues(productSchema.safeParse({ ...valid, ...fields }))).toEqual([message])
  })

  it('чистый жир и вода — тоже продукты', () => {
    const oil = { name: 'Масло', kcal: '899', protein: '0', fat: '99,9', carbs: '0' }
    const water = { name: 'Вода', kcal: '0', protein: '0', fat: '0', carbs: '0' }

    expect(productSchema.safeParse(oil).success).toBe(true)
    expect(productSchema.safeParse(water).success).toBe(true)
  })
})
