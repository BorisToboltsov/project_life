import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  listed,
  type Measurement,
  type Metric,
  useMeasurementSummary,
  useMetrics,
} from '@/api/measurements'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import { formatDelta, formatNumber } from '@/lib/numbers'
import { measuredIn, type UnitSystem } from '@/lib/units'

import { AddMetricLink } from './AddMetricLink'
import { inputUnit } from './entryValues'
import { useMetricName } from './metricName'

function Tile({
  metric,
  system,
  latest,
  previous,
}: {
  metric: Metric
  system: UnitSystem
  latest: Measurement | null
  previous: Measurement | null
}) {
  const { t, i18n } = useTranslation()
  const name = useMetricName()
  const unit = inputUnit(metric, system)
  const unitName = t(`unitNames.${unit}`)
  const delta = latest && previous ? measuredIn(latest, unit) - measuredIn(previous, unit) : null

  return (
    <Link
      to="/measurements/$metric"
      params={{ metric: metric.id }}
      className="grid gap-0.5 rounded-lg border p-3 transition-colors hover:bg-muted/50"
    >
      <span className="text-sm text-muted-foreground">{name(metric)}</span>
      {latest ? (
        <>
          <span className="text-xl font-semibold">
            {formatNumber(measuredIn(latest, unit), i18n.language)}{' '}
            <span className="text-sm font-normal text-muted-foreground">{unitName}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {isoToDisplay(latest.local_date)}
            {delta !== null && ` · ${formatDelta(delta, i18n.language)} ${unitName}`}
          </span>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">{t('measurements.never')}</span>
      )}
    </Link>
  )
}

/**
 * Последние замеры на главной и самый короткий путь к новому. Последняя плитка — «+»:
 * добавить в список свой вид замера.
 */
export function SummaryCard() {
  const { t } = useTranslation()
  const user = useUser()
  const metrics = useMetrics()
  const summary = useMeasurementSummary()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('measurements.title')}</CardTitle>
        <CardAction>
          <Button asChild className="h-11">
            <Link to="/measurements/new">{t('measurements.add')}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {listed(metrics.data?.metrics).map((metric) => {
          const item = summary.data?.find((entry) => entry.metric_id === metric.id)
          return (
            <Tile
              key={metric.id}
              metric={metric}
              system={user.unit_system}
              latest={item?.latest ?? null}
              previous={item?.previous ?? null}
            />
          )
        })}
        {metrics.data && <AddMetricLink label={t('metric.add')} />}
      </CardContent>
    </Card>
  )
}
