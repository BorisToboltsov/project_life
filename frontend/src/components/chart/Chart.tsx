import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import type { LineChartProps } from './LineChart'

const LineChart = lazy(() => import('./LineChart'))

/** График; сам ECharts догружается, когда график впервые понадобился. */
export function Chart(props: LineChartProps) {
  const { t } = useTranslation()
  return (
    <Suspense
      fallback={
        <p className="flex h-64 items-center text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      }
    >
      <LineChart {...props} />
    </Suspense>
  )
}
