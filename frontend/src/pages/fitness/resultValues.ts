import { z } from 'zod'

import type { FitnessResult, FitnessResultInput } from '@/api/fitness'
import { message, numberOf } from '@/components/form/validation'
import { isRealDate, today } from '@/lib/dates'
import {
  COOPER_MAX_M,
  COOPER_MIN_M,
  type FitnessTest,
  METERS_PER_MILE,
  type PushUpVariant,
  REPS_MAX,
} from '@/lib/fitness'
import { parseDecimal } from '@/lib/numbers'
import type { UnitSystem } from '@/lib/units'
import { DATE_MIN, measuredAt } from '@/pages/measurements/entryValues'

export type DistanceUnit = 'm' | 'mi'

export interface ResultValues {
  date: string
  distance: string
  reps: string
  variant: PushUpVariant
}

/** В чём вводят дистанцию Купера: в метрах или милях по профилю. */
export function distanceUnit(system: UnitSystem): DistanceUnit {
  return system === 'imperial' ? 'mi' : 'm'
}

const dateSchema = z
  .string()
  .refine(
    (value) => isRealDate(value) && value >= DATE_MIN && value <= today(),
    message('validation.date'),
  )

/** Форма результата: у Купера проверяется дистанция, у остальных — повторы. */
export function resultSchema(test: FitnessTest, unit: DistanceUnit) {
  const distance =
    test === 'cooper'
      ? z.string().refine(
          (text) => {
            const value = parseDecimal(text)
            if (value === null) return false
            const meters = unit === 'mi' ? value * METERS_PER_MILE : value
            return meters >= COOPER_MIN_M && meters <= COOPER_MAX_M
          },
          message(unit === 'mi' ? 'validation.cooperRangeMiles' : 'validation.cooperRange'),
        )
      : z.string()
  const reps =
    test === 'cooper'
      ? z.string()
      : z.string().refine((text) => {
          const value = text.trim()
          return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= REPS_MAX
        }, message('validation.repsRange'))
  return z.object({ date: dateSchema, distance, reps, variant: z.enum(['classic', 'knee']) })
}

/** Поля формы из сохранённого результата или пустые — для нового. */
export function resultDefaults(
  item: FitnessResult | undefined,
  variant: PushUpVariant,
): ResultValues {
  return {
    date: item?.local_date ?? today(),
    distance: item?.distance_value != null ? String(item.distance_value) : '',
    reps: item?.reps != null ? String(item.reps) : '',
    variant: item?.variant ?? variant,
  }
}

/**
 * Тело запроса. Момент теста — как у замера: сегодня — сейчас, задним числом — полдень;
 * у правки без смены даты прежний момент остаётся.
 */
export function resultBody(
  test: FitnessTest,
  values: ResultValues,
  unit: DistanceUnit,
  item?: FitnessResult,
): FitnessResultInput {
  const moment = {
    tested_at: item && item.local_date === values.date ? item.tested_at : measuredAt(values.date),
    local_date: values.date,
  }
  if (test === 'cooper')
    return { test, ...moment, distance_value: numberOf(values.distance, 3), distance_unit: unit }
  const reps = Number(values.reps.trim())
  // У правки вариант не меняется, и поле с ним выключено: берём его из результата.
  if (test === 'push_ups')
    return { test, ...moment, reps, variant: item?.variant ?? values.variant }
  return { test, ...moment, reps }
}
