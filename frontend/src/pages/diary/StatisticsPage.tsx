import { getRouteApi, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type DiaryStatistics,
  type StatisticsAverage,
  useDiaryStatistics,
} from '@/api/diaryStatistics'
import { useUser } from '@/auth/useSession'
import { FormError, SelectField } from '@/components/form/fields'
import { ProgressBar } from '@/components/ProgressBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import { formatMl, share } from '@/lib/nutrition'
import { formatDelta, formatNumber } from '@/lib/numbers'
import { displayUnit, measuredIn } from '@/lib/units'
import { useOfflineState } from '@/offline/store'

import { Measure } from './Measure'
import { periodStart, shiftPeriod } from './statisticsPeriod'

const CaloriesChart = lazy(() => import('@/components/chart/CaloriesChart'))
const route = getRouteApi('/app/diary/stats')
const MACROS = ['protein_g', 'fat_g', 'carbs_g'] as const
const PERIODS = ['week', 'month'] as const

function GoalCoverage({ average }: { average: StatisticsAverage }) {
  const { t } = useTranslation()
  return average.goal === null && average.goal_days > 0 ? (
    <p className="text-xs text-muted-foreground">
      {t('statistics.goalCoverage', { count: average.goal_days, total: average.days })}
    </p>
  ) : null
}

function NutritionSummary({ data }: { data: DiaryStatistics }) {
  const { t } = useTranslation()
  return data.kcal.value === null ? null : (
    <div className="grid gap-4">
      <div>
        <h2 className="font-medium">{t('statistics.average')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('statistics.foodDays', { count: data.kcal.days })}
        </p>
      </div>
      <div>
        <Measure
          label={t('nutrients.kcal')}
          unit="kcal"
          eaten={data.kcal.value}
          goal={data.kcal.goal ?? undefined}
          prominent
        />
        <GoalCoverage average={data.kcal} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {MACROS.map((key, index) => (
          <div key={key}>
            <Measure
              label={t((['nutrients.protein', 'nutrients.fat', 'nutrients.carbs'] as const)[index])}
              unit="grams"
              eaten={data[key].value!}
              goal={data[key].goal ?? undefined}
            />
            <GoalCoverage average={data[key]} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StatisticsContent({ data }: { data: DiaryStatistics }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const [selected, setSelected] = useState(
    data.days.find((d) => d.local_date === data.today)?.local_date ?? data.start,
  )
  const day = data.days.find((d) => d.local_date === selected) ?? data.days[0]
  const first = data.first_weight,
    last = data.last_weight
  const unit = displayUnit('mass', user.unit_system)
  const unitName = t(`unitNames.${unit}`)
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('statistics.calories')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('statistics.recordedDays', {
              count: data.kcal.days,
              total: data.days.filter((d) => !d.future).length,
            })}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {data.kcal.value === null ? (
            <p className="py-8 text-center text-muted-foreground">{t('statistics.emptyFood')}</p>
          ) : (
            <Suspense fallback={<p className="flex h-64 items-center">{t('common.loading')}</p>}>
              <CaloriesChart days={data.days} onSelect={setSelected} />
            </Suspense>
          )}
          <div className="grid gap-2 rounded-lg bg-muted p-3">
            <SelectField
              label={t('statistics.day')}
              value={day.local_date}
              onChange={(e) => setSelected(e.target.value)}
            >
              {data.days.map((d) => (
                <option key={d.local_date} value={d.local_date}>
                  {isoToDisplay(d.local_date)}
                </option>
              ))}
            </SelectField>
            <div aria-live="polite">
              {day.future ? (
                <p>{t('statistics.future')}</p>
              ) : day.totals ? (
                <Measure
                  label={
                    day.local_date === data.today
                      ? t('statistics.todayPartial')
                      : t('nutrients.kcal')
                  }
                  unit="kcal"
                  eaten={day.totals.kcal}
                  goal={day.goal?.kcal ?? undefined}
                />
              ) : (
                <p>{t('statistics.noEntries')}</p>
              )}
            </div>
            {!day.future && (
              <Link
                to="/diary/$date"
                params={{ date: day.local_date }}
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              >
                {t('statistics.openDay')}
              </Link>
            )}
          </div>
          <NutritionSummary data={data} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('statistics.water')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.water_ml.value === null ? (
            <p className="text-muted-foreground">{t('statistics.emptyWater')}</p>
          ) : (
            <>
              <p className="text-xl font-semibold">
                {data.water_ml.goal === null
                  ? t('water.amount', { value: formatMl(data.water_ml.value, i18n.language) })
                  : t('water.of', {
                      value: formatMl(data.water_ml.value, i18n.language),
                      goal: formatMl(data.water_ml.goal, i18n.language),
                    })}
              </p>
              {data.water_ml.goal !== null && (
                <ProgressBar
                  label={t('statistics.water')}
                  value={share(data.water_ml.value, data.water_ml.goal)}
                />
              )}
              <p className="text-sm text-muted-foreground">
                {t('statistics.waterDays', { count: data.water_ml.days })}
              </p>
              <GoalCoverage average={data.water_ml} />
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('statistics.weight')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!first ? (
            <p className="text-muted-foreground">{t('statistics.emptyWeight')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {[first, last].map(
                  (measurement, index) =>
                    measurement && (
                      <div key={measurement.id}>
                        <p className="text-xs text-muted-foreground">
                          {t(index === 0 ? 'statistics.firstWeight' : 'statistics.lastWeight')}
                        </p>
                        <p className="text-xl font-semibold">
                          {t('statistics.weightValue', {
                            value: formatNumber(measuredIn(measurement, unit), i18n.language),
                            unit: unitName,
                          })}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {isoToDisplay(measurement.local_date)}
                        </p>
                      </div>
                    ),
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {last
                  ? t('statistics.weightChange', {
                      value: formatDelta(
                        measuredIn(last, unit) - measuredIn(first, unit),
                        i18n.language,
                      ),
                      unit: unitName,
                    })
                  : t('statistics.singleWeight')}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}

export function StatisticsPage() {
  const { t } = useTranslation()
  const { date, period } = route.useSearch()
  const query = useDiaryStatistics(date, period)
  const { online } = useOfflineState()
  const data = query.data?.data
  const failure = query.data?.failure ?? (query.isError ? 'errors.network' : undefined)
  const start = periodStart(date, period)
  const previous = shiftPeriod(date, period, -1),
    next = shiftPeriod(date, period, 1)
  return (
    <div className="grid gap-4">
      <Link
        to="/diary/$date"
        params={{ date }}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('nav.diary')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('statistics.title')}</h1>
      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p}
            asChild
            variant={p === period ? 'default' : 'outline'}
            className="h-11 rounded-full"
          >
            <Link
              to="/diary/stats"
              search={{ date, period: p }}
              aria-current={p === period ? 'page' : undefined}
            >
              {t(`statistics.${p}`)}
            </Link>
          </Button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="outline" className="size-11" disabled={previous < '1900-01-01'}>
          <Link
            to="/diary/stats"
            search={{ date: previous < '1900-01-01' ? start : previous, period }}
            aria-label={t('statistics.previous')}
            aria-disabled={previous < '1900-01-01'}
          >
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>
        <p className="text-center text-sm font-medium">
          {data
            ? t('statistics.range', {
                start: isoToDisplay(data.start),
                end: isoToDisplay(data.end),
              })
            : isoToDisplay(start)}
        </p>
        <Button asChild variant="outline" className="size-11">
          <Link
            to="/diary/stats"
            search={{ date: next > '9998-12-31' ? start : next, period }}
            aria-label={t('statistics.next')}
          >
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {data && (data.today < data.start || data.today > data.end) && (
        <Link
          to="/diary/stats"
          search={{ date: data.today, period }}
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          {t('statistics.currentPeriod')}
        </Link>
      )}
      {query.isPending && <p role="status">{t('common.loading')}</p>}
      {failure && !online && <p className="text-muted-foreground">{t('statistics.offline')}</p>}
      {failure && online && (
        <div>
          <FormError failure={failure} />
          <Button className="mt-2 h-11" variant="outline" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {data && <StatisticsContent key={`${data.start}-${data.end}`} data={data} />}
    </div>
  )
}
