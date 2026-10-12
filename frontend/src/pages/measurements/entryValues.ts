import { z } from 'zod'

import type { Metric } from '@/api/measurements'
import { message } from '@/components/form/validation'
import { isoToLocalDate, isRealDate, today } from '@/lib/dates'
import { parseDecimal } from '@/lib/numbers'
import { displayUnit, type Quantity, toCanonical, type Unit, type UnitSystem } from '@/lib/units'

/** Самая ранняя дата замера, которую принимает сервер. */
export const DATE_MIN = '1900-01-01'

/** Единица, в которой пользователь вводит показатель. */
export function inputUnit(metric: Pick<Metric, 'quantity'>, system: UnitSystem): Unit {
  return displayUnit(metric.quantity, system)
}

/** Проверка одного поля со значением: пусто либо число в допустимом для показателя диапазоне. */
function valueSchema(metric: Metric, unit: Unit) {
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
      return canonical >= metric.min_value && canonical <= metric.max_value
    }, message('validation.measurementRange'))
}

const dateSchema = z
  .string()
  .refine(
    (value) => isRealDate(value) && value >= DATE_MIN && value <= today(),
    message('validation.date'),
  )

/**
 * Форма нового замера: дата и по полю на каждый вид из списка — под его ключом; пустые
 * поля не сохраняются.
 */
export function entrySchema(metrics: Metric[], system: UnitSystem) {
  const fields = Object.fromEntries(
    metrics.map((metric) => [metric.id, valueSchema(metric, inputUnit(metric, system))]),
  )
  return z.object({ date: dateSchema, values: z.object(fields) })
}

export interface EntryValues {
  date: string
  values: Record<string, string>
}

/** Форма правки одного замера. */
export function editSchema(metric: Metric, system: UnitSystem) {
  return z.object({
    date: dateSchema,
    value: valueSchema(metric, inputUnit(metric, system)).refine(
      (text) => text.trim() !== '',
      message('validation.required'),
    ),
  })
}

export interface EditValues {
  date: string
  value: string
}

/** Что может измерять свой вид замера, в порядке выбора в форме. */
export const QUANTITIES = ['length', 'mass', 'percent'] as const satisfies readonly Quantity[]

const nameSchema = z
  .string()
  .trim()
  .min(1, message('validation.required'))
  .max(40, message('validation.metricName'))

/** Свой вид замера: название и что измеряем. */
export const metricSchema = z.object({ name: nameSchema, quantity: z.enum(QUANTITIES) })

export type MetricValues = z.infer<typeof metricSchema>

/** Новое название своего вида замера. */
export const renameSchema = z.object({ name: nameSchema })

export type RenameValues = z.infer<typeof renameSchema>

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
