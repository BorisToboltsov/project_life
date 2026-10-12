import { useTranslation } from 'react-i18next'

import type { Metric } from '@/api/measurements'

/**
 * Название вида замера: своего — как его назвал пользователь, штатного — на языке
 * интерфейса.
 */
export function useMetricName(): (metric: Pick<Metric, 'preset' | 'name'>) => string {
  const { t } = useTranslation()
  return (metric) => metric.name ?? (metric.preset ? t(`metrics.${metric.preset}`) : '')
}
