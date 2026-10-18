import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Schemas } from '@/api/client'
import { useExerciseProgress } from '@/api/exercises'
import { useUser } from '@/auth/useSession'
import { ChoiceChip } from '@/components/form/ChoiceChip'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import { clockText, lowerIsFaster, paceLabel, paceValue } from '@/lib/pace'
import { displayUnit, fromCanonical } from '@/lib/units'

type Progress = Schemas['ExerciseProgressOut']

interface Shown {
  key: string
  workoutId: string
  date: string
  value: number
}

/**
 * Лучшее значение тренировки по датам. `inverted` — меньшее значение рисуется выше: так у
 * темпа «быстрее — выше».
 */
function MiniChart({
  title,
  points,
  label,
  inverted = false,
}: {
  title: string
  points: Shown[]
  label: (value: number) => string
  inverted?: boolean
}) {
  const values = points.map((point) => point.value)
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const share = (value: number) => (value - lowest) / (highest - lowest || 1)
  const y = (value: number) => 105 - (inverted ? 1 - share(value) : share(value)) * 75
  const x = (index: number) => 24 + (index / Math.max(1, points.length - 1)) * 252
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-sm font-medium">{title}</p>
      <svg viewBox="0 0 300 130" className="w-full" role="img" aria-label={title}>
        <line x1="24" y1="110" x2="280" y2="110" stroke="currentColor" opacity="0.35" />
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke="var(--primary)"
            strokeWidth="3"
            points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')}
          />
        )}
        {points.map((point, index) => (
          <g key={point.key}>
            <circle cx={x(index)} cy={y(point.value)} r="5" fill="var(--primary)" />
            <text
              x={x(index)}
              y={y(point.value) - 10}
              textAnchor="middle"
              fontSize="11"
              fill="currentColor"
            >
              {label(point.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function Records({ records }: { records: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      {records.map(([name, value]) => (
        <div key={name} className="rounded-lg border p-3">
          <dt className="text-muted-foreground">{name}</dt>
          <dd className="font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function PointLinks({ points, label }: { points: Shown[]; label: (value: number) => string }) {
  return (
    <ul className="grid gap-1 text-sm">
      {points.map((point) => (
        <li key={point.key}>
          <Link
            to="/workouts/$id"
            params={{ id: point.workoutId }}
            className="text-primary underline"
          >
            {isoToDisplay(point.date)}: {label(point.value)}
          </Link>
        </li>
      ))}
    </ul>
  )
}

type View = 'distance' | 'pace' | 'time'

/**
 * Кардио (ADR 0021): график переключается между дистанцией, темпом и временем; рекорды —
 * самая длинная дистанция, самое долгое время и лучший темп по подходам от 1 км.
 */
function CardioProgress({ progress }: { progress: Progress }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const imperial = user.unit_system === 'imperial'
  const number = (value: number, digits = 1) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value)
  const distanceUnit = imperial ? 'mi' : 'km'
  const distance = (km: number) =>
    `${number(km / (imperial ? 1.609344 : 1))} ${t(`unitNames.${distanceUnit}`)}`
  const minutes = (seconds: number) => `${number(seconds / 60)} ${t('progress.minutes')}`
  const unit = progress.pace_unit ?? 'per_km'
  const paceUnit = t(`progress.paceUnits.${paceLabel(unit, imperial)}`)
  const pace = (secondsPerKm: number) => {
    const value = paceValue(secondsPerKm, unit, imperial)
    return unit === 'speed' ? `${number(value)} ${paceUnit}` : `${clockText(value)} ${paceUnit}`
  }

  const series: Record<View, Shown[]> = {
    distance: [],
    pace: [],
    time: [],
  }
  for (const point of progress.cardio) {
    const base = { workoutId: point.workout_id, date: point.local_date }
    if (point.distance_km !== null)
      series.distance.push({ ...base, key: point.workout_id, value: point.distance_km })
    if (point.pace_seconds_per_km !== null)
      series.pace.push({ ...base, key: point.workout_id, value: point.pace_seconds_per_km })
    if (point.duration_seconds !== null)
      series.time.push({ ...base, key: point.workout_id, value: point.duration_seconds })
  }
  const views = (['distance', 'pace', 'time'] as const).filter((view) => series[view].length > 0)
  const [chosen, setChosen] = useState<View>()
  const view = chosen && views.includes(chosen) ? chosen : views[0]
  const label = { distance, pace, time: minutes }
  const records = [
    progress.max_distance_km != null && [
      t('progress.distance'),
      distance(progress.max_distance_km),
    ],
    progress.max_duration_seconds != null && [
      t('progress.time'),
      minutes(progress.max_duration_seconds),
    ],
    progress.best_pace_seconds_per_km != null && [
      t('progress.pace'),
      pace(progress.best_pace_seconds_per_km),
    ],
  ].filter((record): record is [string, string] => Boolean(record))
  if (!view) return <Records records={records} />
  const title =
    view === 'pace'
      ? // Время на отрезок рисуется перевёрнутым, скорость — как есть: быстрее всегда выше.
        `${t('progress.views.pace')}, ${paceUnit} · ${t('progress.paceHigher')}`
      : t(`progress.views.${view}`)

  return (
    <>
      {views.length > 1 && (
        <div role="radiogroup" aria-label={t('progress.chart')} className="flex flex-wrap gap-2">
          {views.map((option) => (
            <ChoiceChip
              key={option}
              name="cardio-view"
              value={option}
              checked={option === view}
              onChange={() => setChosen(option)}
            >
              {t(`progress.views.${option}`)}
            </ChoiceChip>
          ))}
        </div>
      )}
      <MiniChart
        title={title}
        points={series[view]}
        label={label[view]}
        inverted={view === 'pace' && lowerIsFaster(unit)}
      />
      <Records records={records} />
      {progress.best_pace_seconds_per_km != null && (
        <p className="text-sm text-muted-foreground">{t('progress.paceNote')}</p>
      )}
      <PointLinks points={series[view]} label={label[view]} />
    </>
  )
}

export function ExerciseProgress({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const query = useExerciseProgress(id)
  const progress = query.data
  if (!progress) return null
  const weightUnit = displayUnit('mass', user.unit_system)
  const distanceUnit = user.unit_system === 'imperial' ? 'mi' : 'km'
  const shown = (value: number, metric = progress.metric) => {
    if (metric === 'weight_kg') return fromCanonical(value, weightUnit)
    if (metric === 'distance_km')
      return Math.round((value / (distanceUnit === 'mi' ? 1.609344 : 1)) * 10) / 10
    return value
  }
  const unit = (metric: string) => {
    if (metric === 'weight_kg') return t(`unitNames.${weightUnit}`)
    if (metric === 'distance_km') return t(`unitNames.${distanceUnit}`)
    if (metric === 'duration_seconds') return t('progress.seconds')
    return t('progress.reps')
  }
  const label = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)
  const points = progress.points.map((point) => ({
    key: point.workout_id,
    workoutId: point.workout_id,
    date: point.local_date,
    value: shown(point.value),
  }))
  const records = [
    progress.max_weight_kg != null && [
      t('progress.weight'),
      `${label(shown(progress.max_weight_kg, 'weight_kg'))} ${t(`unitNames.${weightUnit}`)}`,
    ],
    progress.max_reps != null && [t('progress.reps'), String(progress.max_reps)],
    progress.max_duration_seconds != null && [
      t('progress.time'),
      `${progress.max_duration_seconds} ${t('progress.seconds')}`,
    ],
    progress.max_distance_km != null && [
      t('progress.distance'),
      `${label(shown(progress.max_distance_km, 'distance_km'))} ${t(`unitNames.${distanceUnit}`)}`,
    ],
  ].filter((record): record is [string, string] => Boolean(record))
  const cardio = progress.kind === 'cardio'
  const empty = cardio ? progress.cardio.length === 0 : points.length === 0
  const withUnit = (value: number) => `${label(value)} ${unit(progress.metric)}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('progress.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {empty ? (
          <p className="text-sm text-muted-foreground">{t('progress.noData')}</p>
        ) : cardio ? (
          <CardioProgress progress={progress} />
        ) : (
          <>
            <MiniChart
              title={`${t('progress.chart')}: ${unit(progress.metric)}`}
              points={points}
              label={label}
            />
            <Records records={records} />
            <PointLinks points={points} label={withUnit} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
