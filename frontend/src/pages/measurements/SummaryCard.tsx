import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  type Measurement,
  type MetricType,
  useMeasurementSummary,
  useMetricTypes,
} from '@/api/measurements'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import { formatDelta, formatNumber } from '@/lib/numbers'
import { measuredIn, type UnitSystem } from '@/lib/units'

import { inputUnit } from './entryValues'

function Tile({
  type,
  system,
  latest,
  previous,
}: {
  type: MetricType
  system: UnitSystem
  latest: Measurement | null
  previous: Measurement | null
}) {
  const { t, i18n } = useTranslation()
  const unit = inputUnit(type, system)
  const unitName = t(`unitNames.${unit}`)
  const delta = latest && previous ? measuredIn(latest, unit) - measuredIn(previous, unit) : null

  return (
    <Link
      to="/measurements/$metric"
      params={{ metric: type.code }}
      className="grid gap-0.5 rounded-lg border p-3 transition-colors hover:bg-muted/50"
    >
      <span className="text-sm text-muted-foreground">{t(`metrics.${type.code}`)}</span>
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

/** Последние замеры на главной и самый короткий путь к новому. */
export function SummaryCard() {
  const { t } = useTranslation()
  const user = useUser()
  const types = useMetricTypes()
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
        {types.data?.map((type) => {
          const item = summary.data?.find((entry) => entry.metric === type.code)
          return (
            <Tile
              key={type.code}
              type={type}
              system={user.unit_system}
              latest={item?.latest ?? null}
              previous={item?.previous ?? null}
            />
          )
        })}
      </CardContent>
    </Card>
  )
}
