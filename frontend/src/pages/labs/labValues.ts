import { z } from 'zod'

import type { Schemas } from '@/api/client'
import { message, numberOf } from '@/components/form/validation'
import { isRealDate, today } from '@/lib/dates'
import { labCanonical, type LabPresetInfo, type LabUnit } from '@/lib/labs'
import { parseDecimal } from '@/lib/numbers'
import { DATE_MIN } from '@/pages/measurements/entryValues'

/** Самое большое значение своего показателя, которое примет сервер. */
const OWN_MAX = 999_999

/** До скольких знаков после запятой хранит сервер. */
const DIGITS = 4

const optionalText = (max: number, key: Parameters<typeof message>[0]) =>
  z.string().trim().max(max, message(key))

/** Шапка бланка: день забора, лаборатория и заметка. */
export const reportSchema = z.object({
  date: z
    .string()
    .refine(
      (value) => isRealDate(value) && value >= DATE_MIN && value <= today(),
      message('validation.date'),
    ),
  lab: optionalText(80, 'validation.nameLength'),
  note: optionalText(500, 'validation.labNote'),
})

export type ReportValues = z.infer<typeof reportSchema>

export function reportBody(values: ReportValues): Schemas['LabReportIn'] {
  return { local_date: values.date, lab: values.lab || null, note: values.note || null }
}

/** Число из поля: пусто — `null`, не число — `undefined`. */
function optionalNumber(text: string): number | null | undefined {
  if (text.trim() === '') return null
  return parseDecimal(text) ?? undefined
}

/**
 * Значение показателя: число, единица и референс, как на бланке. У штатного число
 * проверяется в канонической единице по диапазону справочника.
 */
export function valueSchema(preset: LabPresetInfo | undefined) {
  return z
    .object({
      value: z.string().refine((text) => parseDecimal(text) !== null, message('validation.number')),
      unit: z.string(),
      low: z
        .string()
        .refine((text) => optionalNumber(text) !== undefined, message('validation.number')),
      high: z
        .string()
        .refine((text) => optionalNumber(text) !== undefined, message('validation.number')),
    })
    .refine(
      ({ value, unit }) => {
        const number = parseDecimal(value)
        if (number === null) return true
        if (!preset) return number <= OWN_MAX
        const canonical = labCanonical(preset, number, unit as LabUnit)
        return canonical >= preset.min_value && canonical <= preset.max_value
      },
      { message: message('validation.measurementRange'), path: ['value'] },
    )
    .refine(
      ({ low, high }) => {
        const from = optionalNumber(low)
        const to = optionalNumber(high)
        return from == null || to == null || from <= to
      },
      { message: message('validation.labReference'), path: ['high'] },
    )
}

export type ValueFields = z.infer<ReturnType<typeof valueSchema>>

/** Тело запроса значения: у штатного — с единицей бланка, у своего — без неё. */
export function valueBody(
  values: ValueFields,
  analyte: { preset: Schemas['LabPreset'] } | { analyteId: string },
): Schemas['LabValueIn'] {
  const bound = (text: string) => (text.trim() === '' ? null : numberOf(text, DIGITS))
  return {
    ...('preset' in analyte
      ? { preset: analyte.preset, unit: values.unit as LabUnit }
      : { analyte_id: analyte.analyteId }),
    value: numberOf(values.value, DIGITS),
    ref_low: bound(values.low),
    ref_high: bound(values.high),
  }
}

/** Свой показатель: название и единица текстом. */
export const ownAnalyteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('validation.required'))
    .max(60, message('validation.labName')),
  unit: z
    .string()
    .trim()
    .min(1, message('validation.required'))
    .max(20, message('validation.labUnit')),
})

export type OwnAnalyteValues = z.infer<typeof ownAnalyteSchema>
