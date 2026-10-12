import { Navigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { listed, useMetrics } from '@/api/measurements'

import { AddMetricLink } from './AddMetricLink'

/** Раздел «Замеры» без выбранного вида: открывает первый из списка пользователя. */
export function MeasurementsIndexPage() {
  const { t } = useTranslation()
  const metrics = useMetrics()

  if (metrics.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const [first] = listed(metrics.data?.metrics)
  if (first) {
    return <Navigate to="/measurements/$metric" params={{ metric: first.id }} replace />
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('measurements.title')}</h1>
      <p className="text-muted-foreground">{t('metric.listEmpty')}</p>
      <AddMetricLink label={t('metric.addLong')} />
    </div>
  )
}
