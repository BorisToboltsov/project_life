import { z } from 'zod'

import type { Metric, MetricType } from '@/api/measurements'
import { message } from '@/components/form/validation'
import { isoToLocalDate, isRealDate, today } from '@/lib/dates'
import { parseDecimal } from '@/lib/numbers'
import { displayUnit, toCanonical, type Unit, type UnitSystem } from '@/lib/units'

/** Самая ранняя дата замера, которую принимает сервер. */
export const DATE_MIN = '1900-01-01'

/** Единица, в которой пользователь вводит показатель. */
export function inputUnit(type: MetricType, system: UnitSystem): Unit {
  return displayUnit(type.quantity, system)
}

/** Проверка одного поля со значением: пусто либо число в допустимом для показателя диапазоне. */
function valueSchema(type: MetricType, unit: Unit) {
  return z
    .string()
    .refine(
      (text) => text.trim() === '' || parseDecimal(text) !== null,
      message('validation.number'),
    )
    .refine((text) => {
      const value = parseDecimal(text)
      if (value === null) return true
      const canonical = toCanonical(value, unit)
      return canonical >= type.min_value && canonical <= type.max_value
    }, message('validation.measurementRange'))
}

const dateSchema = z
  .string()
  .refine(
    (value) => isRealDate(value) && value >= DATE_MIN && value <= today(),
    message('validation.date'),
  )

/** Форма нового замера: дата и по полю на каждый показатель; пустые поля не сохраняются. */
export function entrySchema(types: MetricType[], system: UnitSystem) {
  const fields = Object.fromEntries(
    types.map((type) => [type.code, valueSchema(type, inputUnit(type, system))]),
  ) as Record<Metric, ReturnType<typeof valueSchema>>
  return z.object({ date: dateSchema, ...fields })
}

export type EntryValues = { date: string } & Record<Metric, string>

/** Форма правки одного замера. */
export function editSchema(type: MetricType, system: UnitSystem) {
  return z.object({
    date: dateSchema,
    value: valueSchema(type, inputUnit(type, system)).refine(
      (text) => text.trim() !== '',
      message('validation.required'),
    ),
  })
}

export interface EditValues {
  date: string
  value: string
}

/**
 * Момент измерения для выбранной даты: сегодня — сейчас, задним числом — местный полдень
 * того дня (время в прошлом пользователь не вводит).
 */
export function measuredAt(date: string, now: Date = new Date()): string {
  if (date === today()) return now.toISOString()
  const noon = isoToLocalDate(date) ?? now
  noon.setHours(12)
  return noon.toISOString()
}
