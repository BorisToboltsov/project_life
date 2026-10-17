import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useExercises } from '@/api/exercises'
import {
  deleteWorkoutGroup,
  GROUPS_KEY,
  startWorkoutGroup,
  useWorkoutGroups,
  type WorkoutGroup,
} from '@/api/workoutGroups'
import { useWorkouts, WORKOUTS_KEY } from '@/api/workouts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import { useExerciseName } from '@/pages/exercises/exerciseText'

import { WorkoutGroupForm } from './WorkoutGroupForm'

import { WEEKDAYS } from './groupSchedule'

export function WorkoutGroups({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const groups = useWorkoutGroups()
  const workouts = useWorkouts()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<WorkoutGroup | 'new' | null>(null)
  const [failure, setFailure] = useState<ErrorKey>()
  const [busy, setBusy] = useState(false)
  const pending = useRef<{
    group: string
    signature: string
    id: string
    item_ids: string[]
  } | null>(null)
  const active = workouts.data?.find((workout) => workout.finished_at === null)
  const list = groups.data?.groups ?? []
  const todayGroups = list.filter((group) => group.scheduled)

  async function start(group: WorkoutGroup) {
    if (!groups.data) return
    const signature = group.exercise_ids.join(',')
    if (pending.current?.group !== group.id || pending.current.signature !== signature) {
      pending.current = {
        group: group.id,
        signature,
        id: uuidv7(),
        item_ids: group.exercise_ids.map(() => uuidv7()),
      }
    }
    const request = pending.current
    setBusy(true)
    setFailure(undefined)
    const result = await startWorkoutGroup(group.id, {
      id: request.id,
      item_ids: request.item_ids,
      exercise_ids: group.exercise_ids,
      started_at: new Date().toISOString(),
      local_date: groups.data.date,
    })
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    await client.invalidateQueries({ queryKey: WORKOUTS_KEY })
    await navigate({ to: '/workouts/$id', params: { id: request.id } })
  }

  async function remove(group: WorkoutGroup) {
    if (!window.confirm(t('workoutGroups.deleteConfirm', { name: group.name }))) return
    setBusy(true)
    const result = await deleteWorkoutGroup(group.id)
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    await client.invalidateQueries({ queryKey: GROUPS_KEY })
  }

  if (editing)
    return (
      <WorkoutGroupForm
        group={editing === 'new' ? undefined : editing}
        onClose={() => setEditing(null)}
      />
    )

  return (
    <section className="grid gap-4" aria-label={t('workoutGroups.title')}>
      {groups.isPending ? (
        <p>{t('common.loading')}</p>
      ) : groups.isError ? (
        <p role="alert">{t('workoutGroups.loadError')}</p>
      ) : (
        <>
          <h2 className="text-lg font-semibold">
            {t('workoutGroups.today')}
            {groups.data && ` · ${isoToDisplay(groups.data.date)}`}
          </h2>
          {todayGroups.length ? (
            todayGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                todayCard={true}
                compact={compact}
                busy={busy}
                blocked={workouts.isPending || workouts.isError || Boolean(active)}
                onStart={start}
                onEdit={setEditing}
                onRemove={remove}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{t('workoutGroups.noPlan')}</p>
          )}
          {!compact && (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{t('workoutGroups.title')}</h2>
                <Button variant="outline" onClick={() => setEditing('new')}>
                  {t('workoutGroups.create')}
                </Button>
              </div>
              {list.length ? (
                list.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    todayCard={false}
                    compact={compact}
                    busy={busy}
                    blocked={workouts.isPending || workouts.isError || Boolean(active)}
                    onStart={start}
                    onEdit={setEditing}
                    onRemove={remove}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">{t('workoutGroups.empty')}</p>
              )}
            </>
          )}
        </>
      )}
      {failure && (
        <p role="alert" className="text-destructive">
          {t(failure)}
        </p>
      )}
    </section>
  )
}

function GroupCard({
  group,
  todayCard,
  compact,
  busy,
  blocked,
  onStart,
  onEdit,
  onRemove,
}: {
  group: WorkoutGroup
  todayCard: boolean
  compact: boolean
  busy: boolean
  blocked: boolean
  onStart: (group: WorkoutGroup) => Promise<void>
  onEdit: (group: WorkoutGroup) => void
  onRemove: (group: WorkoutGroup) => Promise<void>
}) {
  const { t } = useTranslation()
  const exercises = useExercises()
  const nameOf = useExerciseName()
  const selected = group.exercise_ids.map((id) =>
    exercises.data?.exercises.find((exercise) => exercise.id === id),
  )
  const unavailable = selected.some((exercise) => !exercise || exercise.archived)
  return (
    <Card key={group.id}>
      <CardHeader>
        <CardTitle>
          <h3>{group.name}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {selected
            .map((exercise) => (exercise ? nameOf(exercise) : t('workoutGroups.unavailable')))
            .join(' · ')}
        </p>
        {!todayCard && (
          <div className="text-sm text-muted-foreground">
            {(group.weekdays ?? []).length > 0 && (
              <p>
                {group.weekdays?.map((day) => t(`weekdays.${WEEKDAYS[day]!}`)).join(', ')} ·{' '}
                {t('workoutGroups.from')}: {group.start_date && isoToDisplay(group.start_date)}
                {group.end_date &&
                  ` · ${t('workoutGroups.until')}: ${isoToDisplay(group.end_date)}`}
              </p>
            )}
            {(group.dates ?? []).length > 0 && (
              <p>
                {t('workoutGroups.extraDates')}: {group.dates?.map(isoToDisplay).join(', ')}
              </p>
            )}
            {!group.weekdays?.length && !group.dates?.length && (
              <p>{t('workoutGroups.unscheduled')}</p>
            )}
          </div>
        )}
        {unavailable && !exercises.isPending && (
          <p className="text-sm text-destructive">{t('workoutGroups.fixExercises')}</p>
        )}
        <Button
          className="h-11"
          disabled={busy || blocked || unavailable}
          onClick={() => void onStart(group)}
        >
          {t('workoutGroups.start')}
        </Button>
        {!compact && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onEdit(group)}>
              {t('workoutGroups.edit')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void onRemove(group)}>
              {t('workoutGroups.delete')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
