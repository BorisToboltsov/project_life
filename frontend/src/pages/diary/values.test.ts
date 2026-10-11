import { describe, expect, it } from 'vitest'

import { amountSchema, goalSchema } from './values'

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

  it('принимает разумную цель', () => {
    expect(goalSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    [{ kcal: '499' }, 'validation.goalKcalRange'],
    [{ kcal: '10001' }, 'validation.goalKcalRange'],
    [{ kcal: '' }, 'validation.goalKcalRange'],
    [{ protein: '1001' }, 'validation.goalMacroRange'],
    [{ carbs: 'много' }, 'validation.goalMacroRange'],
  ])('отклоняет %o', (fields, message) => {
    expect(issues(goalSchema.safeParse({ ...valid, ...fields }))).toEqual([message])
  })
})
