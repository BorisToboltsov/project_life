import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteMeasurement,
  type Measurement,
  MEASUREMENTS_KEY,
  type Metric,
  METRICS,
  type MetricType,
  useMeasurementHistory,
  useMetricTypes,
} from '@/api/measurements'
import { useUser } from '@/auth/useSession'
import { Chart } from '@/components/chart/Chart'
import { FormError, SelectField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { formatNumber } from '@/lib/numbers'
import { movingAverage, type Point } from '@/lib/trend'
import { measuredIn, type Unit } from '@/lib/units'

import { inputUnit } from './entryValues'
import { type Period, PERIODS, periodStart } from './periods'

/** Линия тренда имеет смысл, когда есть что сглаживать. */
const TREND_MIN_POINTS = 3

function MetricTabs({ current }: { current: Metric }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('measurements.title')} className="flex gap-1 overflow-x-auto">
      {METRICS.map((metric) => (
        <Link
          key={metric}
          to="/measurements/$metric"
          params={{ metric }}
          aria-current={metric === current ? 'page' : undefined}
          className={
            metric === current
              ? 'rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground'
              : 'rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted'
          }
        >
          {t(`metrics.${metric}`)}
        </Link>
      ))}
    </nav>
  )
}

function HistoryRow({ item, unit }: { item: Measurement; unit: Unit }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteMeasurement(item.id)
    if (result.failure) setFailure(result.failure)
    await queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY })
  }

  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            {formatNumber(measuredIn(item, unit), i18n.language)} {t(`unitNames.${unit}`)}
          </p>
          <p className="text-sm text-muted-foreground">{isoToDisplay(item.local_date)}</p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">{t('measurements.deleteConfirm')}</span>
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              {t('measurements.deleteYes')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('measurements.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button asChild variant="ghost" size="icon" aria-label={t('measurements.edit')}>
              <Link to="/measurements/$metric/$id" params={{ metric: item.metric, id: item.id }}>
                <Pencil aria-hidden="true" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('measurements.delete')}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <FormError failure={failure} />
    </li>
  )
}

function History({ type, metric }: { type: MetricType; metric: Metric }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const [period, setPeriod] = useState<Period>('quarter')
  const history = useMeasurementHistory(metric, periodStart(period))
  const unit = inputUnit(type, user.unit_system)
  const unitName = t(`unitNames.${unit}`)

  // История приходит новыми записями вперёд; графику нужен порядок по времени.
  const points = useMemo<Point[]>(
    () =>
      (history.data ?? [])
        .map((item) => ({ date: item.local_date, value: measuredIn(item, unit) }))
        .reverse(),
    [history.data, unit],
  )
  const values = useMemo(() => ({ name: t('measurements.chartValues'), points }), [points, t])
  const trend = useMemo(() => {
    if (points.length < TREND_MIN_POINTS) return undefined
    const smoothed = movingAverage(points)
    // При редких замерах в окно попадает одна точка, и тренд повторяет сами замеры —
    // вторая линия поверх первой ничего не сообщает.
    const differs = smoothed.some((point, index) => point.value !== points[index].value)
    return differs ? { name: t('measurements.chartTrend'), points: smoothed } : undefined
  }, [points, t])
  const formatValue = useCallback(
    (value: number) => `${formatNumber(value, i18n.language)} ${unitName}`,
    [i18n.language, unitName],
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('measurements.chartTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SelectField
            label={t('measurements.period')}
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
          >
            {PERIODS.map((option) => (
              <option key={option} value={option}>
                {t(`periods.${option}`)}
              </option>
            ))}
          </SelectField>
          {points.length >= 2 ? (
            <Chart
              values={values}
              trend={trend}
              formatValue={formatValue}
              label={`${t('measurements.chartTitle')}: ${t(`metrics.${metric}`)}`}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('measurements.chartNeedsMore')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('measurements.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('measurements.empty')}</p>
          )}
          <ul aria-label={t('measurements.history')} className="grid gap-2">
            {history.data?.map((item) => (
              <HistoryRow key={item.id} item={item} unit={unit} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}

const route = getRouteApi('/app/measurements/$metric')

/** История и график одного показателя; показатели переключаются вкладками. */
export function MeasurementsPage() {
  const { t } = useTranslation()
  const { metric } = route.useParams()
  const types = useMetricTypes()
  const type = types.data?.find((candidate) => candidate.code === metric)

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('measurements.title')}</h1>
        <Button asChild className="h-11">
          <Link to="/measurements/new">{t('measurements.add')}</Link>
        </Button>
      </div>
      <MetricTabs current={metric} />
      {type ? (
        <History key={metric} type={type} metric={metric} />
      ) : (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      )}
    </div>
  )
}
