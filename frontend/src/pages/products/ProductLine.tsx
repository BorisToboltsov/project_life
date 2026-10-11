import { useTranslation } from 'react-i18next'

import type { Product } from '@/api/nutrition'
import { formatGrams, formatKcal } from '@/lib/nutrition'

/** Название продукта и его состав на 100 г или 100 мл второй строкой. */
export function ProductLine({ product }: { product: Product }) {
  const { t, i18n } = useTranslation()
  return (
    <>
      <span className="block font-medium break-words">{product.name}</span>
      <span className="block text-sm text-muted-foreground">
        {t('addFood.per100', {
          kcal: formatKcal(product.kcal, i18n.language),
          protein: formatGrams(product.protein_g, i18n.language),
          fat: formatGrams(product.fat_g, i18n.language),
          carbs: formatGrams(product.carbs_g, i18n.language),
          unit: t(`productUnits.${product.unit}`),
        })}
      </span>
    </>
  )
}
