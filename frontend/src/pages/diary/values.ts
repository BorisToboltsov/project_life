import { z } from 'zod'

import { numberIn } from '@/components/form/validation'

/** Самый ранний день дневника, который принимает сервер. */
export const DATE_MIN = '1900-01-01'

/** Сколько граммов съедено. */
export const amountSchema = z.object({ amount: numberIn(0.1, 5000, 'validation.amountRange') })

export type AmountValues = z.infer<typeof amountSchema>

/** Цель на день: целые килокалории и граммы. */
export const goalSchema = z.object({
  kcal: numberIn(500, 10000, 'validation.goalKcalRange'),
  protein: numberIn(0, 1000, 'validation.goalMacroRange'),
  fat: numberIn(0, 1000, 'validation.goalMacroRange'),
  carbs: numberIn(0, 1000, 'validation.goalMacroRange'),
})

export type GoalValues = z.infer<typeof goalSchema>
