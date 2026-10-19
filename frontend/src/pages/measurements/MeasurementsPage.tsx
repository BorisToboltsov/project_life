import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  deleteMeasurement,
  deleteMetric,
  listed,
  type Measurement,
  MEASUREMENTS_KEY,
  type Metric,
  METRICS_KEY,
  saveMetric,
  useMeasurementHistory,
  useMetrics,
} from '@/api/measurements'
import { DIARY_KEY } from '@/api/nutrition'
import { useUser } from '@/auth/useSession'
import { Chart } from '@/components/chart/Chart'
import { FormError, SelectField, TextField } from '@/components/form/fields'
import { PendingMark } from '@/components/PendingMark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { formatNumber } from '@/lib/numbers'
import { movingAverage, type Point } from '@/lib/trend'
import { measuredIn, type Unit } from '@/lib/units'
import { useOfflineState } from '@/offline/store'

import { AddMetricLink } from './AddMetricLink'
import { inputUnit, renameSchema, type RenameValues } from './entryValues'
import { useMetricName } from './metricName'
import { type Period, PERIODS, periodStart } from './periods'
import { PressurePanel } from './PressurePanel'

/** Линия тренда имеет смысл, когда есть что сглаживать. */
const TREND_MIN_POINTS = 3

function MetricTab({ metric, active }: { metric: Metric; active: boolean }) {
  const name = useMetricName()
  const link = useRef<HTMLAnchorElement>(null)

  // Видов бывает больше, чем помещается в ряд: вкладка, ставшая текущей, не должна
  // остаться за его краем. Саму страницу прокрутка не двигает.
  useEffect(() => {
    if (active) link.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <Link
      ref={link}
      to="/measurements/$metric"
      params={{ metric: metric.id }}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground'
          : 'shrink-0 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted'
      }
    >
      {name(metric)}
    </Link>
  )
}

function MetricTabs({ metrics, current }: { metrics: Metric[]; current: string }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('measurements.title')} className="flex gap-1 overflow-x-auto">
      {metrics.map((metric) => (
        <MetricTab key={metric.id} metric={metric} active={metric.id === current} />
      ))}
    </nav>
  )
}

function HistoryRow({ item, unit }: { item: Measurement; unit: Unit }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { pending } = useOfflineState()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteMeasurement(item.id)
    if (result.failure) setFailure(result.failure)
    await queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY })
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
  }

  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">
            {formatNumber(measuredIn(item, unit), i18n.language)} {t(`unitNames.${unit}`)}
            {pending.has(item.id) && (
              <span className="ml-1.5 inline-block align-[-2px]">
                <PendingMark />
              </span>
            )}
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
              <Link to="/measurements/$metric/$id" params={{ metric: item.metric_id, id: item.id }}>
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

function History({ metric }: { metric: Metric }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const name = useMetricName()
  const [period, setPeriod] = useState<Period>('quarter')
  const history = useMeasurementHistory(metric.id, periodStart(period))
  const unit = inputUnit(metric, user.unit_system)
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
              label={`${t('measurements.chartTitle')}: ${name(metric)}`}
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

function RenameForm({ metric, onDone }: { metric: Metric; onDone: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const form = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: metric.name ?? '' },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: RenameValues) {
    setFailure(undefined)
    const result = await saveMetric(metric.id, { name: values.name, quantity: metric.quantity })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: METRICS_KEY })
    onDone()
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-3"
    >
      <FormError failure={failure} />
      <TextField
        label={t('metric.name')}
        autoComplete="off"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <div className="flex gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={onDone}>
          {t('measurements.cancel')}
        </Button>
      </div>
    </form>
  )
}

/**
 * Под историей: вид замера убирают из списка, а свой ещё и переименовывают. Убранный вид
 * возвращается с экрана добавления вместе со всеми замерами. Без сети список видов не
 * меняется — действий нет (ADR 0020).
 */
function MetricActions({ metric }: { metric: Metric }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { online } = useOfflineState()
  const name = useMetricName()(metric)
  const [mode, setMode] = useState<'idle' | 'renaming' | 'confirming'>('idle')
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteMetric(metric.id)
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: METRICS_KEY })
    await navigate({ to: '/measurements' })
  }

  if (!online) return null
  if (mode === 'renaming') return <RenameForm metric={metric} onDone={() => setMode('idle')} />
  return (
    <div className="grid gap-2">
      {mode === 'confirming' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t('metric.removeConfirm', { name })}</span>
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            {t('metric.removeYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode('idle')}>
            {t('measurements.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Название штатного вида подбирает интерфейс: переименовать можно только свой. */}
          {!metric.preset && (
            <Button variant="ghost" className="h-11" onClick={() => setMode('renaming')}>
              <Pencil aria-hidden="true" />
              {t('metric.rename')}
            </Button>
          )}
          <Button variant="ghost" className="ml-auto h-11" onClick={() => setMode('confirming')}>
            <Trash2 aria-hidden="true" />
            {t('metric.remove')}
          </Button>
        </div>
      )}
      <FormError failure={failure} />
    </div>
  )
}

const route = getRouteApi('/app/measurements/$metric')

/** История и график одного вида замера; виды из списка переключаются вкладками. */
export function MeasurementsPage() {
  const { t } = useTranslation()
  const { metric: metricId } = route.useParams()
  const metrics = useMetrics()
  const inList = listed(metrics.data?.metrics)
  const metric = inList.find((candidate) => candidate.id === metricId)
  const pressure = metric?.quantity === 'pressure'

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('measurements.title')}</h1>
        <Button asChild className="h-11">
          {pressure ? (
            <Link to="/measurements/pressure/new">{t('pressure.add')}</Link>
          ) : (
            <Link to="/measurements/new">{t('measurements.add')}</Link>
          )}
        </Button>
      </div>
      <MetricTabs metrics={inList} current={metricId} />
      {metrics.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {metric && (
        <>
          {pressure ? <PressurePanel /> : <History key={metric.id} metric={metric} />}
          <MetricActions key={`actions-${metric.id}`} metric={metric} />
        </>
      )}
      {/* Незнакомый ключ или вид, убранный из списка: выбрать другой дают вкладки выше. */}
      {!metrics.isPending && !metric && (
        <>
          <p>{t('metric.notFound')}</p>
          <AddMetricLink label={t('metric.addLong')} />
        </>
      )}
    </div>
  )
}
