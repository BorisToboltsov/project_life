import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useExerciseProgress } from '@/api/exercises'
import { useUser } from '@/auth/useSession'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import { displayUnit, fromCanonical } from '@/lib/units'

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
  const points = progress.points.map((point) => ({ ...point, shown: shown(point.value) }))
  const values = points.map((point) => point.shown)
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const y = (value: number) => 105 - ((value - lowest) / (highest - lowest || 1)) * 75
  const x = (index: number) => 24 + (index / Math.max(1, points.length - 1)) * 252
  const label = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)
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
  ].filter((record): record is string[] => Boolean(record))

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('progress.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('progress.noData')}</p>
        ) : (
          <>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm font-medium">
                {t('progress.chart')}: {unit(progress.metric)}
              </p>
              <svg
                viewBox="0 0 300 130"
                className="w-full"
                role="img"
                aria-label={t('progress.chart')}
              >
                <line x1="24" y1="110" x2="280" y2="110" stroke="currentColor" opacity="0.35" />
                {points.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="3"
                    points={points.map((point, index) => `${x(index)},${y(point.shown)}`).join(' ')}
                  />
                )}
                {points.map((point, index) => (
                  <g key={point.workout_id}>
                    <circle cx={x(index)} cy={y(point.shown)} r="5" fill="var(--primary)" />
                    <text
                      x={x(index)}
                      y={y(point.shown) - 10}
                      textAnchor="middle"
                      fontSize="11"
                      fill="currentColor"
                    >
                      {label(point.shown)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {records.map(([name, value]) => (
                <div key={name} className="rounded-lg border p-3">
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="grid gap-1 text-sm">
              {points.map((point) => (
                <li key={point.workout_id}>
                  <Link
                    to="/workouts/$id"
                    params={{ id: point.workout_id }}
                    className="text-primary underline"
                  >
                    {isoToDisplay(point.local_date)}: {label(point.shown)} {unit(progress.metric)}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
