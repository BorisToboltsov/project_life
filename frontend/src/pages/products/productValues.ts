import { z } from 'zod'

import type { Product } from '@/api/nutrition'
import { message, numberIn, numberOf } from '@/components/form/validation'

/** Продукт каталога: состав на 100 г. */
export const productSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, message('validation.required'))
      .max(120, message('validation.productName')),
    kcal: numberIn(0, 900, 'validation.kcalRange'),
    protein: numberIn(0, 100, 'validation.macroRange'),
    fat: numberIn(0, 100, 'validation.macroRange'),
    carbs: numberIn(0, 100, 'validation.macroRange'),
  })
  .refine(
    (values) => {
      const macros = [values.protein, values.fat, values.carbs].map((text) => numberOf(text, 2))
      // Сумму проверяем, когда каждое поле само в порядке: иначе хватит его ошибки.
      return macros.some((value) => value > 100) || macros[0] + macros[1] + macros[2] <= 100
    },
    { path: ['carbs'], message: message('validation.macroSum') },
  )

export type ProductValues = z.infer<typeof productSchema>

export function productDefaults(product?: Product): ProductValues {
  return {
    name: product?.name ?? '',
    kcal: product ? String(product.kcal) : '',
    protein: product ? String(product.protein_g) : '',
    fat: product ? String(product.fat_g) : '',
    carbs: product ? String(product.carbs_g) : '',
  }
}
