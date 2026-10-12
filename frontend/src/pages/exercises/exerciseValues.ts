import { z } from 'zod'

import { message } from '@/components/form/validation'

import { KINDS, MUSCLES } from './exerciseText'

/** Своё упражнение: название, что записывает подход и какие мышцы работают. */
export const exerciseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, message('validation.required'))
    .max(60, message('validation.exerciseName')),
  kind: z.enum(KINDS),
  muscles: z.array(z.enum(MUSCLES)),
})

export type ExerciseValues = z.infer<typeof exerciseSchema>
