import { useTranslation } from 'react-i18next'

import { formatNumber } from '@/lib/numbers'
import type { Deferred } from '@/offline/db'

/** Количество отложенной записи, пока продукт неизвестен: упаковки или «г или мл». */
export function useDeferredAmount(): (item: Deferred) => string {
  const { t, i18n } = useTranslation()
  return (item) =>
    'packages' in item.amount
      ? t('deferred.amountPackages', {
          count: formatNumber(item.amount.packages, i18n.language, 2),
        })
      : t('deferred.amountUnits', { value: formatNumber(item.amount.units, i18n.language) })
}
