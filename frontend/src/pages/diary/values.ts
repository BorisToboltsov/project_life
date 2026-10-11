import { z } from 'zod'

import { message, numberIn, optionalNumberIn } from '@/components/form/validation'
import { parseDecimal } from '@/lib/numbers'
import { macrosEnergy } from '@/lib/nutrition'

/** Самый ранний день дневника, который принимает сервер. */
export const DATE_MIN = '1900-01-01'

/** Сколько съедено, в единицах продукта. */
export const amountSchema = z.object({ amount: numberIn(0.1, 5000, 'validation.amountRange') })

export type AmountValues = z.infer<typeof amountSchema>

const goalKcal = optionalNumberIn(500, 10000, 'validation.goalKcalRange')
const goalMacro = optionalNumberIn(0, 1000, 'validation.goalMacroRange')

/**
 * Цель на день: целые килокалории и граммы. Любое поле можно оставить пустым — цели по
 * этому показателю нет. Калории — предел для белков, жиров и углеводов.
 */
export const goalSchema = z
  .object({ kcal: goalKcal, protein: goalMacro, fat: goalMacro, carbs: goalMacro })
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
