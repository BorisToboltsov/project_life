import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteFitnessResult,
  FITNESS_KEY,
  type FitnessResult,
  useFitnessResults,
} from '@/api/fitness'
import { useUser } from '@/auth/useSession'
import { Chart } from '@/components/chart/Chart'
import { FormError } from '@/components/form/fields'
import { ExerciseFigure } from '@/components/illustrations/exercise/ExerciseFigure'
import { PendingMark } from '@/components/PendingMark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { type FitnessTest, headline, LEVELS, type Rating, rate } from '@/lib/fitness'
import { formatDelta, formatNumber } from '@/lib/numbers'
import type { Point } from '@/lib/trend'
import { useOfflineState } from '@/offline/store'

import { CooperTimer } from './CooperTimer'
import {
  rawOf,
  testOf,
  useHeadlineText,
  useRatingText,
  useRawText,
  useRepsText,
  useVo2maxText,
} from './fitnessText'
import { timerRunning } from './timerStorage'

/** Рисунок техники из журнала тренировок; у Купера рисунка нет (ADR 0021). */
const DRAWING = { push_ups: 'push_up', pull_ups: 'pull_up' } as const

/** С чем сравнивать: прошлый результат того же теста, у отжиманий — того же варианта. */
function previousOf(items: FitnessResult[], latest: FitnessResult): FitnessResult | undefined {
  return items.find((item) => item.id !== latest.id && item.variant === latest.variant)
}

/** Пять ступеней шкалы; текущая — цветом бренда. */
function ScaleBar({ rating }: { rating: Rating }) {
  const { t } = useTranslation()
  const { level } = useRatingText()(rating)
  return (
    <div role="img" aria-label={t('fitness.rating', { level })} className="flex gap-1">
      {LEVELS[rating.scale].map((step, index) => (
        <span
          key={step}
          className={
            index === rating.index
              ? 'h-2 flex-1 rounded-sm bg-(--brand)'
              : 'h-2 flex-1 rounded-sm bg-muted'
          }
        />
      ))}
    </div>
  )
}

/** Оценка по нормам или почему её нет. */
function RatingBlock({ result }: { result: FitnessResult }) {
  const { t } = useTranslation()
  const user = useUser()
  const ratingText = useRatingText()
  const rated = rate(result, user)
  if ('rating' in rated) {
    const { level, source } = ratingText(rated.rating)
    return (
      <div className="grid gap-1.5">
        <ScaleBar rating={rated.rating} />
        <p className="text-sm">
          <span className="font-medium">{level}</span>
          <span className="block text-muted-foreground">{source}</span>
        </p>
      </div>
    )
  }
  if (rated.missing === 'none') return null
  return (
    <p className="text-sm text-muted-foreground">
      {t(`fitness.missing.${rated.missing}`)}
      {rated.missing === 'profile' && (
        <>
          {' '}
          <Link to="/profile" className="text-primary underline">
            {t('fitness.toProfile')}
          </Link>
        </>
      )}
    </p>
  )
}

function LatestCard({ test, items }: { test: FitnessTest; items: FitnessResult[] }) {
  const { t, i18n } = useTranslation()
  const raw = useRawText()
  const reps = useRepsText()
  const vo2 = useVo2maxText()
  const { pending } = useOfflineState()
  const [latest] = items
  if (!latest) {
    return (
      <Card>
        <CardContent>
          <p className="text-muted-foreground">{t('fitness.never')}</p>
        </CardContent>
      </Card>
    )
  }
  const previous = previousOf(items, latest)
  const delta = previous && headline(latest) - headline(previous)
  const detail =
    test === 'cooper'
      ? t('fitness.cooperLine', { distance: raw(rawOf(latest)) })
      : latest.variant && t(`pushUpVariants.${latest.variant}`)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('fitness.latest')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {[isoToDisplay(latest.local_date), detail].filter(Boolean).join(' · ')}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-semibold tabular-nums">
            {test === 'cooper' ? vo2(latest.distance_m ?? 0) : reps(latest.reps ?? 0)}
          </span>
          {test === 'cooper' && (
            <span className="text-sm text-muted-foreground">{t('fitness.vo2max')}</span>
          )}
          {pending.has(latest.id) && (
            <span className="self-center">
              <PendingMark />
            </span>
          )}
        </p>
        {delta !== undefined && (
          <p className="text-sm text-muted-foreground">
            {t('fitness.change', { delta: formatDelta(delta, i18n.language) })}
          </p>
        )}
        <RatingBlock result={latest} />
      </CardContent>
    </Card>
  )
}

function HistoryRow({ item }: { item: FitnessResult }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { pending } = useOfflineState()
  const headlineText = useHeadlineText()
  const raw = useRawText()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteFitnessResult(item.id)
    if (result.failure) setFailure(result.failure)
    await queryClient.invalidateQueries({ queryKey: FITNESS_KEY })
  }

  const detail = [
    isoToDisplay(item.local_date),
    item.test === 'cooper' && raw(rawOf(item)),
    item.variant && t(`pushUpVariants.${item.variant}`),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 font-medium">
            {headlineText(item)}
            {pending.has(item.id) && <PendingMark />}
          </p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
        {confirming ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-sm">{t('fitness.deleteConfirm')}</span>
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              {t('fitness.deleteYes')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('fitness.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button asChild variant="ghost" size="icon" aria-label={t('fitness.edit')}>
              <Link to="/workouts/tests/$test/$id" params={{ test: item.test, id: item.id }}>
                <Pencil aria-hidden="true" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('fitness.delete')}
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

function History({ test, items }: { test: FitnessTest; items: FitnessResult[] }) {
  const { t, i18n } = useTranslation()
  const name = t(`fitnessTests.${test}`)
  // Результаты приходят новыми вперёд; графику нужен порядок по времени.
  const points = useMemo<Point[]>(
    () => items.map((item) => ({ date: item.local_date, value: headline(item) })).reverse(),
    [items],
  )
  const values = useMemo(() => ({ name, points }), [name, points])
  const formatValue = useCallback(
    (value: number) => formatNumber(value, i18n.language, test === 'cooper' ? 1 : 0),
    [i18n.language, test],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('fitness.history')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('fitness.empty')}</p>
        ) : points.length >= 2 ? (
          <Chart
            values={values}
            formatValue={formatValue}
            label={`${t('fitness.chart')}: ${name}`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('fitness.chartNeedsMore')}</p>
        )}
        <ul aria-label={t('fitness.history')} className="grid gap-2">
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Протокол теста: шаги, предупреждение, рисунок техники или таймер. */
function HowTo({ test }: { test: FitnessTest }) {
  const { t } = useTranslation()
  const steps = t(`fitnessSteps.${test}`).split('\n')
  return (
    <details
      open={(test === 'cooper' && timerRunning()) || undefined}
      className="group rounded-xl border bg-card"
    >
      <summary className="flex min-h-14 cursor-pointer items-center px-4 font-medium">
        {t('fitness.howTo')}
      </summary>
      <div className="grid gap-4 px-4 pb-4">
        {test !== 'cooper' && (
          <div className="mx-auto w-full max-w-xs rounded-lg bg-muted p-2">
            <ExerciseFigure preset={DRAWING[test]} />
          </div>
        )}
        <ol className="grid list-decimal gap-1 pl-5 text-sm">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="rounded-lg bg-warning p-3 text-sm text-warning-foreground">
          {t('fitness.warning')}
        </p>
        {test === 'cooper' && <CooperTimer />}
      </div>
    </details>
  )
}

const route = getRouteApi('/app/workouts/tests/$test')

/**
 * Экран теста (ADR 0021): сверху последний результат с оценкой, ниже — внести новый,
 * история с графиком и протокол.
 */
export function FitnessTestPage() {
  const { t } = useTranslation()
  const test = testOf(route.useParams().test)
  const results = useFitnessResults()
  const items = useMemo(
    () => (results.data ?? []).filter((item) => item.test === test),
    [results.data, test],
  )

  if (!test) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('fitness.title')}</h1>
        <p className="text-muted-foreground">{t('fitness.unknownTest')}</p>
        <BackToTests />
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t(`fitnessTests.${test}`)}</h1>
      {results.isPending ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <LatestCard test={test} items={items} />
      )}
      <Button asChild className="h-11">
        <Link to="/workouts/tests/$test/new" params={{ test }}>
          {t('fitness.enter')}
        </Link>
      </Button>
      {!results.isPending && <History test={test} items={items} />}
      <HowTo test={test} />
      <BackToTests />
    </div>
  )
}

function BackToTests() {
  const { t } = useTranslation()
  return (
    <Button asChild variant="ghost" className="h-11 justify-self-start">
      <Link to="/workouts">{t('fitness.toTests')}</Link>
    </Button>
  )
}
