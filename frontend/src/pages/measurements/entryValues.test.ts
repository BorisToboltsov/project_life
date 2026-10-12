import { describe, expect, it } from 'vitest'

import { localDateToIso, today } from '@/lib/dates'
import { bodyFat, metrics, wrist } from '@/test/fixtures'

import {
  editSchema,
  entrySchema,
  inputUnit,
  measuredAt,
  metricSchema,
  renameSchema,
} from './entryValues'

const list = [...Object.values(metrics), bodyFat, wrist]
/** Короткие имена полей в тестах: код штатного вида или название своего. */
const codes = new Map(list.map((metric) => [metric.id, metric.preset ?? metric.name ?? '']))

/**
 * Что форма сочла ошибкой. Значения задаются по коротким именам (`weight`, `Запястье`),
 * остальные поля пусты.
 */
function problems(
  entered: Record<string, string>,
  system: 'metric' | 'imperial' = 'metric',
  date = today(),
) {
  const values = Object.fromEntries(list.map((metric) => [metric.id, '']))
  for (const [id, code] of codes) if (code in entered) values[id] = entered[code]
  const result = entrySchema(list, system).safeParse({ date, values })
  return (
    result.error?.issues.map(
      (issue) =>
        `${issue.path.map((part) => codes.get(String(part)) ?? part).join('.')}: ${issue.message}`,
    ) ?? []
  )
}

describe('единица ввода', () => {
  it('зависит от системы единиц профиля', () => {
    const { weight, neck } = metrics
    expect([inputUnit(weight, 'metric'), inputUnit(neck, 'metric')]).toEqual(['kg', 'cm'])
    expect([inputUnit(weight, 'imperial'), inputUnit(neck, 'imperial')]).toEqual(['lb', 'in'])
  })

  it('проценты не зависят от системы единиц', () => {
    expect([inputUnit(bodyFat, 'metric'), inputUnit(bodyFat, 'imperial')]).toEqual([
      'percent',
      'percent',
    ])
  })
})

describe('проверка формы замера', () => {
  it('принимает пустые поля и числа с запятой или точкой', () => {
    expect(problems({ weight: '72,4', waist: '86.5' })).toEqual([])
    expect(problems({})).toEqual([])
  })

  it.each([
    [{ weight: 'много' }, 'values.weight: validation.number'],
    [{ weight: '700' }, 'values.weight: validation.measurementRange'],
    [{ weight: '1' }, 'values.weight: validation.measurementRange'],
    [{ neck: '5' }, 'values.neck: validation.measurementRange'],
    [{ hips: '300' }, 'values.hips: validation.measurementRange'],
    [{ body_fat: '90' }, 'values.body_fat: validation.measurementRange'],
    [{ Запястье: '400' }, 'values.Запястье: validation.measurementRange'],
  ])('%o → %s', (values, expected) => {
    expect(problems(values)).toEqual([expected])
  })

  it.each(['2999-01-01', '17/0', ''])('дата «%s» не принимается', (date) => {
    expect(problems({}, 'metric', date)).toEqual(['date: validation.date'])
  })

  it('свой вид и проценты принимают значения своего диапазона', () => {
    expect(problems({ body_fat: '18,5', Запястье: '16.5' })).toEqual([])
    expect(problems({ Запястье: '6.5' }, 'imperial')).toEqual([])
  })

  it('диапазон проверяется в единицах ввода: 600 фунтов допустимы, 600 кг — нет', () => {
    expect(problems({ weight: '600' }, 'imperial')).toEqual([])
    expect(problems({ weight: '600' }, 'metric')).toEqual([
      'values.weight: validation.measurementRange',
    ])
    expect(problems({ waist: '34' }, 'imperial')).toEqual([])
  })
})

describe('проверка формы правки', () => {
  const schema = editSchema(metrics.weight, 'metric')

  it('значение обязательно', () => {
    const result = schema.safeParse({ date: today(), value: ' ' })

    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['validation.required'])
  })

  it('принимает число в диапазоне', () => {
    expect(schema.safeParse({ date: today(), value: '71,9' }).success).toBe(true)
  })
})

describe('проверка своего вида замера', () => {
  const messages = (values: object) =>
    metricSchema.safeParse(values).error?.issues.map((issue) => issue.message) ?? []

  it('название обрезается по краям, величина — одна из трёх', () => {
    expect(metricSchema.parse({ name: '  Запястье ', quantity: 'length' })).toEqual({
      name: 'Запястье',
      quantity: 'length',
    })
    expect(metricSchema.safeParse({ name: 'Пульс', quantity: 'rate' }).success).toBe(false)
  })

  it.each([
    ['', 'validation.required'],
    ['   ', 'validation.required'],
    ['я'.repeat(41), 'validation.metricName'],
  ])('название «%s» → %s', (name, expected) => {
    expect(messages({ name, quantity: 'mass' })).toEqual([expected])
    expect(renameSchema.safeParse({ name }).error?.issues.map((issue) => issue.message)).toEqual([
      expected,
    ])
  })

  it('название в сорок символов принимается', () => {
    expect(renameSchema.safeParse({ name: 'я'.repeat(40) }).success).toBe(true)
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
