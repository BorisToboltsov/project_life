import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useRef, useState, type TouchEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useExercises, EXERCISES_KEY } from '@/api/exercises'
import {
  addWorkoutExercise,
  deleteWorkout,
  finishWorkout,
  removeWorkoutExercise,
  removeWorkoutSet,
  repeatWorkout,
  saveExerciseRest,
  saveWorkout,
  saveWorkoutSet,
  useWorkout,
  WORKOUTS_KEY,
  type WorkoutExercise,
  type WorkoutSet,
  type WorkoutSetInput,
} from '@/api/workouts'
import { useUser } from '@/auth/useSession'
import { DateField } from '@/components/form/DateField'
import { ExerciseFigure } from '@/components/illustrations/exercise/ExerciseFigure'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateTime, isRealDate, today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import { useExerciseName } from '@/pages/exercises/exerciseText'

import { RestTimer } from './RestTimer'
import { SetEditor } from './SetEditor'
import { startRestTimer } from './restStorage'
import { workoutLocalTime, workoutMoment } from './workoutTime'

export function WorkoutPage() {
  const { id } = useParams({ from: '/app/workouts/$id' })
  return <WorkoutContent key={id} id={id} />
}

function WorkoutContent({ id }: { id: string }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const client = useQueryClient()
  const navigate = useNavigate()
  const nameOf = useExerciseName()
  const query = useWorkout(id)
  const exercises = useExercises()
  const workout = query.data
  const [selectedId, setSelectedId] = useState<string>()
  const [choice, setChoice] = useState('')
  const [editing, setEditing] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()
  const [date, setDate] = useState<string>()
  const [time, setTime] = useState<string>()
  const [rest, setRest] = useState<string>()
  const [restFor, setRestFor] = useState<string>()
  const [revision, setRevision] = useState(0)
  const repeatIds = useRef<{ id: string; item_ids: string[] } | null>(null)
  const pendingItemId = useRef<string | null>(null)
  const items = workout?.exercises ?? []
  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const active = workout?.finished_at === null
  const available =
    exercises.data?.exercises.filter(
      (exercise) => !exercise.archived && !items.some((item) => item.exercise.id === exercise.id),
    ) ?? []
  const selectedRest = selected?.id === restFor ? rest : undefined

  async function refresh() {
    await client.invalidateQueries({ queryKey: WORKOUTS_KEY })
    await client.invalidateQueries({ queryKey: ['exercise-progress'] })
  }

  async function addExercise() {
    if (!choice) return
    setBusy(true)
    setFailure(undefined)
    const itemId = pendingItemId.current ?? uuidv7()
    pendingItemId.current = itemId
    const result = await addWorkoutExercise(id, itemId, choice)
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    pendingItemId.current = null
    setChoice('')
    setSelectedId(itemId)
    await refresh()
  }

  async function saveSet(body: WorkoutSetInput, setId: string) {
    if (!selected) return
    setBusy(true)
    setFailure(undefined)
    const wasEditing = Boolean(editing)
    const result = await saveWorkoutSet(id, selected.id, setId, body)
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    setEditing(undefined)
    setRevision((value) => value + 1)
    await refresh()
    if (!wasEditing) startRestTimer(id, selected.exercise.rest_seconds)
  }

  async function removeSet(value: WorkoutSet) {
    if (!selected || !window.confirm(t('workouts.removeSetConfirm'))) return
    const result = await removeWorkoutSet(id, selected.id, value.id)
    if (result.failure) return setFailure(result.failure)
    setEditing(undefined)
    await refresh()
  }

  async function removeExercise() {
    if (!selected || !window.confirm(t('workouts.removeExerciseConfirm'))) return
    const result = await removeWorkoutExercise(id, selected.id)
    if (result.failure) return setFailure(result.failure)
    setSelectedId(undefined)
    setEditing(undefined)
    await refresh()
  }

  async function saveTime() {
    if (!workout) return
    const nextDate = date ?? workout.local_date
    const nextTime = time ?? workoutLocalTime(workout.started_at, user.timezone)
    const moment = isRealDate(nextDate)
      ? workoutMoment(nextDate, nextTime, user.timezone)
      : undefined
    if (!moment) return setFailure('errors.unknown')
    const result = await saveWorkout(id, { started_at: moment, local_date: nextDate })
    if (result.failure) return setFailure(result.failure)
    setFailure(undefined)
    await refresh()
  }

  async function finish() {
    const result = await finishWorkout(id, new Date().toISOString())
    if (result.failure) return setFailure(result.failure)
    await refresh()
  }

  async function repeat() {
    if (!workout) return
    repeatIds.current ??= {
      id: uuidv7(),
      item_ids: workout.exercises.filter((item) => !item.exercise.archived).map(() => uuidv7()),
    }
    const result = await repeatWorkout(id, {
      ...repeatIds.current,
      started_at: new Date().toISOString(),
      local_date: today(),
    })
    if (result.failure) return setFailure(result.failure)
    await refresh()
    await navigate({ to: '/workouts/$id', params: { id: repeatIds.current.id } })
  }

  async function remove() {
    if (!window.confirm(t('workouts.deleteConfirm'))) return
    const result = await deleteWorkout(id)
    if (result.failure) return setFailure(result.failure)
    await refresh()
    await navigate({ to: '/workouts' })
  }

  async function saveRest() {
    if (!selected) return
    const seconds = Number(selectedRest ?? selected.exercise.rest_seconds)
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 600)
      return setFailure('errors.unknown')
    const result = await saveExerciseRest(selected.exercise.id, seconds)
    if (result.failure) return setFailure(result.failure)
    setFailure(undefined)
    await client.invalidateQueries({ queryKey: EXERCISES_KEY })
    await refresh()
  }

  if (query.isPending) return <p>{t('common.loading')}</p>
  if (!workout) return <p role="alert">{t('workouts.notFound')}</p>
  const dateValue = date ?? workout.local_date
  const timeValue = time ?? workoutLocalTime(workout.started_at, user.timezone)
  const currentSet = selected?.sets.find((value) => value.id === editing)

  return (
    <div className="grid gap-5 pb-24">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('workouts.title')}</h1>
        <span className="text-sm text-muted-foreground">
          {t(active ? 'workouts.active' : 'workouts.finished')}
        </span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{formatDateTime(workout.started_at, i18n.language, user.timezone)}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <DateField label={t('workouts.startedAt')} value={dateValue} onChange={setDate} />
            <div className="grid content-start gap-1.5">
              <Label htmlFor="workout-time">{t('workouts.time')}</Label>
              <Input
                id="workout-time"
                type="time"
                value={timeValue}
                onChange={(event) => setTime(event.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <Button
            variant="outline"
            disabled={!isRealDate(dateValue)}
            onClick={() => void saveTime()}
          >
            {t('workouts.saveTime')}
          </Button>
        </CardContent>
      </Card>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {t(failure)}
        </p>
      )}
      {active && <RestTimer workoutId={id} />}
      {selected ? (
        <section className="grid gap-4">
          <div className="flex items-center gap-3">
            <div className="size-20 shrink-0">
              <ExerciseFigure preset={selected.exercise.preset} still />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{nameOf(selected.exercise)}</h2>
              <Link
                to="/workouts/exercises/$key"
                params={{ key: selected.exercise.preset ?? selected.exercise.id }}
                className="text-sm text-primary underline"
              >
                {t('exercises.technique')}
              </Link>
            </div>
          </div>
          <h3 className="font-medium">{t('workouts.sets')}</h3>
          {selected.sets.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('workouts.noSets')}</p>
          )}
          {selected.sets.map((value, index) => (
            <div key={value.id} className="flex items-center gap-2 rounded-xl border p-3">
              <span className="min-w-0 flex-1 font-medium">
                {index + 1}. {setSummary(value, t)}
              </span>
              {active && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(value.id)}>
                    {t('workouts.editSet')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void removeSet(value)}>
                    {t('workouts.removeSet')}
                  </Button>
                </>
              )}
            </div>
          ))}
          {selected.previous.length > 0 && (
            <div className="rounded-xl bg-muted p-3 text-sm">
              <p className="font-medium">{t('workouts.previous')}</p>
              {selected.previous.map((value, index) => (
                <p key={value.id}>
                  {index + 1}. {setSummary(value, t)}
                </p>
              ))}
            </div>
          )}
          {active && (
            <SetEditor
              key={`${selected.id}-${editing ?? 'new'}-${selected.sets.length}-${revision}`}
              item={selected}
              editing={currentSet}
              onSave={saveSet}
              onCancel={editing ? () => setEditing(undefined) : undefined}
              busy={busy}
            />
          )}
          {active && (
            <RestSetting
              key={selected.id}
              value={selectedRest ?? String(selected.exercise.rest_seconds)}
              onChange={(value) => {
                setRestFor(selected.id)
                setRest(value)
              }}
              onSave={() => void saveRest()}
            />
          )}
          {active && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => void removeExercise()}
            >
              {t('workouts.removeExercise')}
            </Button>
          )}
        </section>
      ) : (
        <p className="text-muted-foreground">{t('workouts.emptyWorkout')}</p>
      )}
      {active && (
        <section className="grid gap-3 rounded-xl border p-4">
          <h2 className="font-medium">{t('workouts.addExercise')}</h2>
          {available.length > 0 ? (
            <div className="flex gap-2">
              <select
                value={choice}
                onChange={(event) => {
                  pendingItemId.current = null
                  setChoice(event.target.value)
                }}
                aria-label={t('workouts.chooseExercise')}
                className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3"
              >
                <option value="">{t('workouts.chooseExercise')}</option>
                {available.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {nameOf(exercise)}
                  </option>
                ))}
              </select>
              <Button disabled={!choice || busy} onClick={() => void addExercise()}>
                {t('workouts.addExercise')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('workouts.noExercises')}</p>
          )}
          <Link to="/workouts/exercises" className="text-sm text-primary underline">
            {t('workouts.exercises')}
          </Link>
        </section>
      )}
      <div className="grid gap-2">
        {active && (
          <Button className="h-11" onClick={() => void finish()}>
            {t('workouts.finish')}
          </Button>
        )}
        {!active && (
          <Button className="h-11" onClick={() => void repeat()}>
            {t('workouts.repeat')}
          </Button>
        )}
        <Button variant="ghost" className="text-destructive" onClick={() => void remove()}>
          {t('workouts.delete')}
        </Button>
      </div>
      {items.length > 0 && (
        <ExerciseStrip
          items={items}
          selectedId={selected?.id}
          onSelect={(itemId) => {
            setSelectedId(itemId)
            setEditing(undefined)
          }}
        />
      )}
    </div>
  )
}

function setSummary(value: WorkoutSet, t: TFunction): string {
  if (value.kind === 'weight_reps')
    return `${value.weight_value} ${t(value.weight_unit === 'lb' ? 'unitNames.lb' : 'unitNames.kg')} × ${value.reps}`
  if (value.kind === 'reps') return `${value.reps} ${t('workouts.reps').toLowerCase()}`
  if (value.kind === 'time') return `${value.duration_seconds} ${t('progress.seconds')}`
  return [
    `${value.duration_seconds} ${t('progress.seconds')}`,
    value.distance_value != null
      ? `${value.distance_value} ${t(value.distance_unit === 'mi' ? 'unitNames.mi' : 'unitNames.km')}`
      : '',
    value.incline_percent != null ? `${t('workouts.incline')}: ${value.incline_percent}` : '',
    value.level != null ? `${t('workouts.level')}: ${value.level}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function RestSetting({
  value,
  onChange,
  onSave,
}: {
  value: string
  onChange: (value: string) => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-end gap-2 rounded-xl border p-3">
      <div className="grid flex-1 gap-1">
        <Label htmlFor="rest-seconds">{t('workouts.restSeconds')}</Label>
        <Input
          id="rest-seconds"
          type="number"
          min={0}
          max={600}
          step={5}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11"
        />
      </div>
      <Button variant="outline" className="h-11" onClick={onSave}>
        {t('workouts.restSave')}
      </Button>
    </div>
  )
}

function ExerciseStrip({
  items,
  selectedId,
  onSelect,
}: {
  items: WorkoutExercise[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const nameOf = useExerciseName()
  const { t } = useTranslation()
  function slide(event: TouchEvent) {
    const finger = event.touches[0]
    if (!finger) return
    const target = document
      .elementFromPoint(finger.clientX, finger.clientY)
      ?.closest('[data-workout-item]')
    const itemId = target?.getAttribute('data-workout-item')
    if (itemId) onSelect(itemId)
  }
  return (
    <nav
      aria-label={t('workouts.chooseExercise')}
      onTouchMove={slide}
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-[9] border-t bg-background/95 p-2 backdrop-blur md:sticky md:bottom-0 md:rounded-xl md:border"
    >
      <div className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-workout-item={item.id}
            aria-label={nameOf(item.exercise)}
            aria-current={item.id === selectedId ? 'true' : undefined}
            onClick={() => onSelect(item.id)}
            className={`size-12 shrink-0 rounded-full border-2 p-0.5 ${item.id === selectedId ? 'border-primary bg-primary/10' : 'border-border'}`}
          >
            <ExerciseFigure preset={item.exercise.preset} still />
          </button>
        ))}
      </div>
    </nav>
  )
}
