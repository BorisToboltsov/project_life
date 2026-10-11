import { describe, expect, it } from 'vitest'

import { amountSchema, goalSchema, mealSchema } from './values'

function issues(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((issue) => issue.message)
}

describe('amountSchema', () => {
  it.each(['150', '0,1', '5000', ' 62.5 '])('принимает %s', (amount) => {
    expect(amountSchema.safeParse({ amount }).success).toBe(true)
  })

  it.each(['', '0', '0,05', '5000,1', '-5', 'много'])('отклоняет «%s»', (amount) => {
    expect(issues(amountSchema.safeParse({ amount }))).toEqual(['validation.amountRange'])
  })
})

describe('goalSchema', () => {
  const valid = { kcal: '2100', protein: '130', fat: '70', carbs: '230' }

  const empty = { kcal: '', protein: '', fat: '', carbs: '' }

  it('принимает разумную цель', () => {
    expect(goalSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    [{ kcal: '2000' }],
    [{ protein: '150' }],
    [{ kcal: '2000', protein: '150' }],
    [{ protein: '130', fat: '70', carbs: '230' }],
    // Пустая цель — тоже цель: так её снимают.
    [{}],
    // БЖУ ровно на все калории: 520 + 630 + 920.
    [{ kcal: '2070', protein: '130', fat: '70', carbs: '230' }],
  ])('принимает любой набор показателей: %o', (fields) => {
    expect(goalSchema.safeParse({ ...empty, ...fields }).success).toBe(true)
  })

  it.each([
    [{ kcal: '499' }, 'validation.goalKcalRange'],
    [{ kcal: '10001' }, 'validation.goalKcalRange'],
    [{ protein: '1001' }, 'validation.goalMacroRange'],
    [{ carbs: 'много' }, 'validation.goalMacroRange'],
    // Белки, жиры и углеводы дают 2070 ккал — в 2069 не помещаются.
    [{ kcal: '2069' }, 'validation.goalOverKcal'],
    [{ kcal: '500', protein: '126', fat: '', carbs: '' }, 'validation.goalOverKcal'],
  ])('отклоняет %o', (fields, message) => {
    expect(issues(goalSchema.safeParse({ ...valid, ...fields }))).toEqual([message])
  })

  it('предел по калориям — ошибка поля калорий', () => {
    const result = goalSchema.safeParse({ ...valid, kcal: '2000' })

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['kcal']])
  })
})

describe('mealSchema', () => {
  it('принимает название до 40 символов', () => {
    expect(mealSchema.safeParse({ name: ' Второй завтрак ' }).data).toEqual({
      name: 'Второй завтрак',
    })
    expect(mealSchema.safeParse({ name: 'я'.repeat(40) }).success).toBe(true)
  })

  it.each([
    ['', 'validation.required'],
    ['   ', 'validation.required'],
    ['я'.repeat(41), 'validation.mealName'],
  ])('отклоняет «%s»', (name, message) => {
    expect(issues(mealSchema.safeParse({ name }))).toEqual([message])
  })
})
