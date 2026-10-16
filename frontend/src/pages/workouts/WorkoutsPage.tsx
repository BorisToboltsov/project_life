import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { saveWorkout, useWorkouts, WORKOUTS_KEY } from '@/api/workouts'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'

import { WorkoutGroups } from './WorkoutGroups'

export function WorkoutsPage() {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const navigate = useNavigate()
  const query = useWorkouts()
  const client = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const [busy, setBusy] = useState(false)
  const pendingId = useRef(uuidv7())
  const active = query.data?.find((workout) => workout.finished_at === null)
  const history = query.data?.filter((workout) => workout.finished_at !== null) ?? []

  async function start() {
    setBusy(true)
    setFailure(undefined)
    const id = pendingId.current
    const result = await saveWorkout(id, {
      started_at: new Date().toISOString(),
      local_date: today(),
    })
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    await client.invalidateQueries({ queryKey: WORKOUTS_KEY })
    await navigate({ to: '/workouts/$id', params: { id } })
  }

  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-semibold">{t('workouts.title')}</h1>
      <WorkoutGroups />
      <Card>
        <CardHeader>
          <CardTitle>{active ? t('workouts.active') : t('workouts.start')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {active ? (
            <Button asChild className="h-11">
              <Link to="/workouts/$id" params={{ id: active.id }}>
                {t('workouts.continue')}
              </Link>
            </Button>
          ) : (
            <Button
              className="h-11"
              disabled={busy || query.isPending}
              onClick={() => void start()}
            >
              {t('workouts.start')}
            </Button>
          )}
          {failure && (
            <p role="alert" className="text-destructive">
              {t(failure)}
            </p>
          )}
        </CardContent>
      </Card>
      <Button asChild variant="outline" className="h-11">
        <Link to="/workouts/exercises">{t('workouts.exercises')}</Link>
      </Button>
      <section className="grid gap-3" aria-label={t('workouts.history')}>
        <h2 className="text-lg font-semibold">{t('workouts.history')}</h2>
        {history.length === 0 && !query.isPending && (
          <p className="text-muted-foreground">{t('workouts.historyEmpty')}</p>
        )}
        {history.map((workout) => (
          <Link
            key={workout.id}
            to="/workouts/$id"
            params={{ id: workout.id }}
            className="block rounded-xl border p-4 hover:bg-muted/50"
          >
            <span className="font-medium">
              {formatDateTime(workout.started_at, i18n.language, user.timezone)}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {t('workouts.exerciseCount', { count: workout.exercise_count })} ·{' '}
              {t('workouts.setCount', { count: workout.set_count })}
            </span>
          </Link>
        ))}
      </section>
    </div>
  )
}
