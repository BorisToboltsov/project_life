import { z } from 'zod'

import { message, numberIn, optionalNumberIn } from '@/components/form/validation'
import { normalizeBarcode } from '@/lib/barcode'
import { parseDecimal } from '@/lib/numbers'
import { macrosEnergy } from '@/lib/nutrition'

/** Самый ранний день дневника, который принимает сервер. */
export const DATE_MIN = '1900-01-01'

/** Порция воды в миллилитрах — своё количество вместо кнопки. */
export const waterSchema = z.object({ amount: numberIn(1, 5000, 'validation.waterRange') })

export type WaterValues = z.infer<typeof waterSchema>

/** Штрихкод, введённый цифрами: опечатку выдаёт контрольная цифра. */
export const barcodeSchema = z.object({
  barcode: z
    .string()
    .refine((text) => normalizeBarcode(text) !== null, message('validation.barcode')),
})

export type BarcodeValues = z.infer<typeof barcodeSchema>

const goalKcal = optionalNumberIn(500, 10000, 'validation.goalKcalRange')
const goalMacro = optionalNumberIn(0, 1000, 'validation.goalMacroRange')
const goalWater = optionalNumberIn(100, 10000, 'validation.goalWaterRange')

/**
 * Цель на день: целые килокалории, граммы и миллилитры воды. Любое поле можно оставить
 * пустым — цели по этому показателю нет. Калории — предел для белков, жиров и углеводов.
 */
export const goalSchema = z
  .object({
    kcal: goalKcal,
    protein: goalMacro,
    fat: goalMacro,
    carbs: goalMacro,
    water: goalWater,
  })
  .refine(
    (values) => {
      const kcal = parseDecimal(values.kcal)
      // Предел проверяем, когда каждое поле само в порядке: иначе хватит его ошибки.
      const fieldsFine =
        goalKcal.safeParse(values.kcal).success &&
        [values.protein, values.fat, values.carbs].every(
          (text) => goalMacro.safeParse(text).success,
        )
      // Без калорий предела нет.
      return !fieldsFine || kcal === null || macrosEnergy(values) <= kcal
    },
    { path: ['kcal'], message: message('validation.goalOverKcal') },
  )

export type GoalValues = z.infer<typeof goalSchema>

/** Свой приём пищи: название. */
export const mealSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('validation.required'))
    .max(40, message('validation.mealName')),
})

export type MealValues = z.infer<typeof mealSchema>
