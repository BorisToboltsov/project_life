import { useTranslation } from 'react-i18next'

import type { ProductUnit } from '@/api/nutrition'
import { intlLocale } from '@/lib/locale'
import { formatNumber } from '@/lib/numbers'
import { formatGrams } from '@/lib/nutrition'
import type { PortionKind } from '@/lib/portions'

/** Формы слова при числе, которые различают словари. */
const FORMS = ['one', 'few', 'many'] as const

/** Число порций или упаковок словами языка интерфейса: «2 порции», «1,5 упаковки». */
export function usePortionsText(): (kind: PortionKind, count: number) => string {
  const { t, i18n } = useTranslation()
  return (kind, count) => {
    const rule = new Intl.PluralRules(intlLocale(i18n.language)).select(count)
    const form = FORMS.find((item) => item === rule) ?? 'other'
    return t(`portionCounts.${kind}.${form}`, { number: formatNumber(count, i18n.language, 2) })
  }
}

/**
 * Количество записи так, как его внесли: «120 г» или «2 порции · 120 г». Порция — та, что
 * в записи: размер у продукта с тех пор мог измениться.
 */
export function useQuantityText(): (item: {
  amount: number
  unit: ProductUnit
  portion: { kind: PortionKind; count: number } | null
}) => string {
  const { t, i18n } = useTranslation()
  const portionsText = usePortionsText()
  return ({ amount, unit, portion }) => {
    const units = t('quantity.units', {
      amount: formatGrams(amount, i18n.language),
      unit: t(`productUnits.${unit}`),
    })
    return portion
      ? t('quantity.portions', { portions: portionsText(portion.kind, portion.count), units })
      : units
  }
}
