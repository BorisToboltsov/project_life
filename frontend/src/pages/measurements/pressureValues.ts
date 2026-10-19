import { z } from 'zod'

import type { Schemas } from '@/api/client'
import { message, type ValidationKey } from '@/components/form/validation'
import { isRealDate, today } from '@/lib/dates'
import { DIASTOLIC, type PressureReading, PULSE, SYSTOLIC } from '@/lib/pressure'
import { workoutLocalTime, workoutMoment } from '@/pages/workouts/workoutTime'

import { DATE_MIN } from './entryValues'

/** Целое число в пределах; необязательное поле можно оставить пустым. */
function whole(range: { min: number; max: number }, key: ValidationKey, optional = false) {
  return z
    .string()
    .trim()
    .refine((text) => {
      if (optional && text === '') return true
      if (!/^\d+$/.test(text)) return false
      const value = Number(text)
      return value >= range.min && value <= range.max
    }, message(key))
}

/** Форма показания: дата и время профиля, верхнее, нижнее и, если есть, пульс. */
export const pressureSchema = z
  .object({
    date: z
      .string()
      .refine(
        (value) => isRealDate(value) && value >= DATE_MIN && value <= today(),
        message('validation.date'),
      ),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, message('validation.time')),
    systolic: whole(SYSTOLIC, 'validation.systolicRange'),
    diastolic: whole(DIASTOLIC, 'validation.diastolicRange'),
    pulse: whole(PULSE, 'validation.pulseRange', true),
  })
  .refine((values) => Number(values.systolic) > Number(values.diastolic), {
    message: message('validation.pressureOrder'),
    path: ['diastolic'],
  })

export type PressureValues = z.infer<typeof pressureSchema>

/** Поля формы: у нового показания — сейчас, у правки — как его внесли. */
export function pressureDefaults(item: PressureReading | undefined, timeZone: string) {
  const at = item?.measured_at ?? new Date().toISOString()
  return {
    date: item?.local_date ?? today(timeZone),
    time: workoutLocalTime(at, timeZone),
    systolic: item ? String(item.systolic) : '',
    diastolic: item ? String(item.diastolic) : '',
    pulse: item?.pulse == null ? '' : String(item.pulse),
  } satisfies PressureValues
}

/** Тело запроса; время, которого нет в поясе профиля (перевод часов), — `undefined`. */
export function pressureBody(
  values: PressureValues,
  timeZone: string,
): Schemas['BloodPressureIn'] | undefined {
  const measured = workoutMoment(values.date, values.time, timeZone)
  if (!measured) return undefined
  return {
    measured_at: measured,
    local_date: values.date,
    systolic: Number(values.systolic),
    diastolic: Number(values.diastolic),
    pulse: values.pulse === '' ? null : Number(values.pulse),
  }
}
