import { describe, expect, it } from 'vitest'

import { localDateToIso, today } from '@/lib/dates'
import { metricTypes } from '@/test/fixtures'

import { editSchema, entrySchema, inputUnit, measuredAt } from './entryValues'

const empty = { date: today(), weight: '', neck: '', waist: '', hips: '' }

function problems(values: object, system: 'metric' | 'imperial' = 'metric') {
  const result = entrySchema(metricTypes, system).safeParse({ ...empty, ...values })
  return result.error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? []
}

describe('единица ввода', () => {
  it('зависит от системы единиц профиля', () => {
    const [weight, neck] = metricTypes
    expect([inputUnit(weight, 'metric'), inputUnit(neck, 'metric')]).toEqual(['kg', 'cm'])
    expect([inputUnit(weight, 'imperial'), inputUnit(neck, 'imperial')]).toEqual(['lb', 'in'])
  })
})

describe('проверка формы замера', () => {
  it('принимает пустые поля и числа с запятой или точкой', () => {
    expect(problems({ weight: '72,4', waist: '86.5' })).toEqual([])
    expect(problems({})).toEqual([])
  })

  it.each([
    [{ weight: 'много' }, 'weight: validation.number'],
    [{ weight: '700' }, 'weight: validation.measurementRange'],
    [{ weight: '1' }, 'weight: validation.measurementRange'],
    [{ neck: '5' }, 'neck: validation.measurementRange'],
    [{ hips: '300' }, 'hips: validation.measurementRange'],
    [{ date: '2999-01-01' }, 'date: validation.date'],
    [{ date: '17/0' }, 'date: validation.date'],
    [{ date: '' }, 'date: validation.date'],
  ])('%o → %s', (values, expected) => {
    expect(problems(values)).toEqual([expected])
  })

  it('диапазон проверяется в единицах ввода: 600 фунтов допустимы, 600 кг — нет', () => {
    expect(problems({ weight: '600' }, 'imperial')).toEqual([])
    expect(problems({ weight: '600' }, 'metric')).toEqual(['weight: validation.measurementRange'])
    expect(problems({ waist: '34' }, 'imperial')).toEqual([])
  })
})

describe('проверка формы правки', () => {
  const schema = editSchema(metricTypes[0], 'metric')

  it('значение обязательно', () => {
    const result = schema.safeParse({ date: today(), value: ' ' })

    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['validation.required'])
  })

  it('принимает число в диапазоне', () => {
    expect(schema.safeParse({ date: today(), value: '71,9' }).success).toBe(true)
  })
})

describe('момент измерения', () => {
  it('для сегодняшней даты — сейчас', () => {
    const now = new Date()

    expect(measuredAt(today(), now)).toBe(now.toISOString())
  })

  it('для прошедшей даты — местный полдень того дня', () => {
    const moment = new Date(measuredAt('2020-01-15'))

    expect(localDateToIso(moment)).toBe('2020-01-15')
    expect(moment.getHours()).toBe(12)
  })
})
