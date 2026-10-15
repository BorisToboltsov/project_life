import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { saveWorkout, useWorkouts, WORKOUTS_KEY } from '@/api/workouts'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'

export function WorkoutHomeCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useWorkouts()
  const active = query.data?.find((workout) => workout.finished_at === null)
  const [failure, setFailure] = useState<ErrorKey>()
  const [busy, setBusy] = useState(false)
  const pendingId = useRef(uuidv7())

  async function start() {
    setBusy(true)
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
    <Card>
      <CardHeader>
        <CardTitle>{t('workouts.title')}</CardTitle>
        <CardAction>
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
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2">
        {active && <p className="text-sm text-muted-foreground">{t('workouts.active')}</p>}
        {failure && (
          <p role="alert" className="text-destructive">
            {t(failure)}
          </p>
        )}
        <Link to="/workouts" className="text-sm text-primary underline">
          {t('workouts.history')}
        </Link>
      </CardContent>
    </Card>
  )
}
