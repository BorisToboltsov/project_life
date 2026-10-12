import { z } from 'zod'

import { type Product, type ProductDraft, PRODUCT_UNITS } from '@/api/nutrition'
import { message, numberIn, numberOf, optionalNumberIn } from '@/components/form/validation'
import { normalizeBarcode } from '@/lib/barcode'
import { parseDecimal } from '@/lib/numbers'

/** Часть не больше целого; пока одно из полей пусто или с ошибкой, сравнивать нечего. */
function within(part: string, whole: string): boolean {
  const [value, limit] = [parseDecimal(part), parseDecimal(whole)]
  return value === null || limit === null || numberOf(part, 2) <= numberOf(whole, 2)
}

/** Продукт каталога: в чём он измеряется и состав на 100 таких единиц. */
export const productSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, message('validation.required'))
      .max(120, message('validation.productName')),
    unit: z.enum(PRODUCT_UNITS),
    kcal: numberIn(0, 900, 'validation.kcalRange'),
    protein: numberIn(0, 100, 'validation.macroRange'),
    fat: numberIn(0, 100, 'validation.macroRange'),
    carbs: numberIn(0, 100, 'validation.macroRange'),
    // Что ещё печатают на этикетке: каждое поле можно оставить пустым.
    saturatedFat: optionalNumberIn(0, 100, 'validation.macroRange'),
    sugars: optionalNumberIn(0, 100, 'validation.macroRange'),
    fiber: optionalNumberIn(0, 100, 'validation.macroRange'),
    salt: optionalNumberIn(0, 100, 'validation.macroRange'),
    // Штрихкода может не быть; введённый обязан быть штрихкодом товара.
    barcode: z
      .string()
      .refine(
        (text) => text.trim() === '' || normalizeBarcode(text) !== null,
        message('validation.barcode'),
      ),
  })
  .refine(
    (values) => {
      const macros = [values.protein, values.fat, values.carbs].map((text) => numberOf(text, 2))
      // Сумму проверяем, когда каждое поле само в порядке: иначе хватит его ошибки.
      return macros.some((value) => value > 100) || macros[0] + macros[1] + macros[2] <= 100
    },
    { path: ['carbs'], message: message('validation.macroSum') },
  )
  // Насыщенные жиры — часть жиров, сахара — часть углеводов.
  .refine((values) => within(values.saturatedFat, values.fat), {
    path: ['saturatedFat'],
    message: message('validation.saturatedOverFat'),
  })
  .refine((values) => within(values.sugars, values.carbs), {
    path: ['sugars'],
    message: message('validation.sugarsOverCarbs'),
  })

export type ProductValues = z.infer<typeof productSchema>

/**
 * С чего начинается форма: продукт каталога или заготовка нового — то, что о нём известно
 * по штрихкоду.
 */
export type ProductSeed = Partial<ProductDraft> & Partial<Pick<Product, 'barcode'>>

export function productDefaults(seed: ProductSeed = {}): ProductValues {
  const text = (value: number | null | undefined) => (value == null ? '' : String(value))
  return {
    name: seed.name ?? '',
    unit: seed.unit ?? 'g',
    kcal: text(seed.kcal),
    protein: text(seed.protein_g),
    fat: text(seed.fat_g),
    carbs: text(seed.carbs_g),
    saturatedFat: text(seed.saturated_fat_g),
    sugars: text(seed.sugars_g),
    fiber: text(seed.fiber_g),
    salt: text(seed.salt_g),
    barcode: seed.barcode ?? '',
  }
}
