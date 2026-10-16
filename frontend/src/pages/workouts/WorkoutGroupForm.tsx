import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useExercises } from '@/api/exercises'
import { GROUPS_KEY, saveWorkoutGroup, type WorkoutGroup } from '@/api/workoutGroups'
import { CheckChip } from '@/components/form/CheckChip'
import { DateField } from '@/components/form/DateField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isRealDate, isoToDisplay, today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import { useExerciseName } from '@/pages/exercises/exerciseText'

import { WEEKDAYS } from './groupSchedule'

export function WorkoutGroupForm({
  group,
  onClose,
}: {
  group?: WorkoutGroup
  onClose: () => void
}) {
  const { t } = useTranslation()
  const exercises = useExercises()
  const nameOf = useExerciseName()
  const client = useQueryClient()
  const id = useRef(group?.id ?? uuidv7())
  const [name, setName] = useState(group?.name ?? '')
  const [ids, setIds] = useState(group?.exercise_ids ?? [])
  const [weekdays, setWeekdays] = useState(group?.weekdays ?? [])
  const [start, setStart] = useState(group?.start_date ?? today())
  const [end, setEnd] = useState(group?.end_date ?? '')
  const [dates, setDates] = useState(group?.dates ?? [])
  const [extraDate, setExtraDate] = useState('')
  const [choice, setChoice] = useState('')
  const [failure, setFailure] = useState<ErrorKey>()
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const available =
    exercises.data?.exercises.filter(
      (exercise) => !exercise.archived && !ids.includes(exercise.id),
    ) ?? []

  function move(index: number, direction: number) {
    const next = [...ids]
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setIds(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      !name.trim() ||
      ids.length === 0 ||
      ids.length > 100 ||
      dates.length > 366 ||
      (weekdays.length > 0 &&
        (!isRealDate(start) || (end !== '' && (!isRealDate(end) || end < start))))
    ) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setBusy(true)
    setFailure(undefined)
    const result = await saveWorkoutGroup(id.current, {
      name: name.trim(),
      exercise_ids: ids,
      weekdays: [...weekdays].sort(),
      start_date: weekdays.length ? start : null,
      end_date: weekdays.length && end ? end : null,
      dates: [...dates].sort(),
    })
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    await client.invalidateQueries({ queryKey: GROUPS_KEY })
    onClose()
  }

  return (
    <form className="grid gap-5 rounded-xl border p-4" onSubmit={(event) => void submit(event)}>
      <h2 className="text-xl font-semibold">
        {t(group ? 'workoutGroups.edit' : 'workoutGroups.create')}
      </h2>
      <div className="grid gap-2">
        <Label htmlFor="group-name">{t('workoutGroups.name')}</Label>
        <Input
          id="group-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          required
        />
      </div>
      <h3 className="font-medium">{t('workoutGroups.orderedExercises')}</h3>
      <ol className="grid gap-3">
        {ids.map((exerciseId, index) => {
          const exercise = exercises.data?.exercises.find((value) => value.id === exerciseId)
          const label = exercise ? nameOf(exercise) : t('workoutGroups.unavailable')
          return (
            <li key={exerciseId} className="grid gap-2 rounded-lg border p-3">
              <span>
                {index + 1}. {label}
                {exercise?.archived && ` · ${t('exercises.outOfList')}`}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === 0}
                  aria-label={t('workoutGroups.moveUp', { name: label })}
                  onClick={() => move(index, -1)}
                >
                  {t('workoutGroups.up')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === ids.length - 1}
                  aria-label={t('workoutGroups.moveDown', { name: label })}
                  onClick={() => move(index, 1)}
                >
                  {t('workoutGroups.down')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('workoutGroups.removeExercise', { name: label })}
                  onClick={() => setIds(ids.filter((value) => value !== exerciseId))}
                >
                  {t('workoutGroups.remove')}
                </Button>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="grid gap-2 sm:flex">
        <select
          className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3"
          aria-label={t('workouts.chooseExercise')}
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">{t('workouts.chooseExercise')}</option>
          {available.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>
              {nameOf(exercise)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={!choice || ids.length >= 100}
          onClick={() => {
            setIds([...ids, choice])
            setChoice('')
          }}
        >
          {t('workouts.addExercise')}
        </Button>
      </div>
      <Link to="/workouts/exercises" className="text-sm text-primary underline">
        {t('workouts.exercises')}
      </Link>
      <fieldset className="grid gap-3">
        <legend className="mb-3 font-medium">{t('workoutGroups.weekly')}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day, index) => (
            <CheckChip
              key={day}
              checked={weekdays.includes(index)}
              onChange={() =>
                setWeekdays(
                  weekdays.includes(index)
                    ? weekdays.filter((value) => value !== index)
                    : [...weekdays, index],
                )
              }
            >
              {t(`weekdays.${day}`)}
            </CheckChip>
          ))}
        </div>
        {weekdays.length > 0 && (
          <>
            <DateField label={t('workoutGroups.from')} value={start} onChange={setStart} />
            <DateField label={t('workoutGroups.until')} value={end} onChange={setEnd} />
            <p className="text-sm text-muted-foreground">{t('workoutGroups.noEnd')}</p>
          </>
        )}
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="mb-3 font-medium">{t('workoutGroups.extraDates')}</legend>
        <p className="text-sm text-muted-foreground">{t('workoutGroups.extraHint')}</p>
        <DateField label={t('workoutGroups.extraDate')} value={extraDate} onChange={setExtraDate} />
        <Button
          type="button"
          variant="outline"
          disabled={!isRealDate(extraDate) || dates.includes(extraDate) || dates.length >= 366}
          onClick={() => {
            setDates([...dates, extraDate].sort())
            setExtraDate('')
          }}
        >
          {t('workoutGroups.addDate')}
        </Button>
        <ul className="grid gap-2">
          {dates.map((date) => (
            <li key={date} className="flex items-center justify-between gap-2">
              <span>{isoToDisplay(date)}</span>
              <Button
                type="button"
                variant="ghost"
                aria-label={t('workoutGroups.removeDate', { date: isoToDisplay(date) })}
                onClick={() => setDates(dates.filter((value) => value !== date))}
              >
                {t('workoutGroups.remove')}
              </Button>
            </li>
          ))}
        </ul>
      </fieldset>
      {invalid && (
        <p role="alert" className="text-destructive">
          {t('workoutGroups.invalid')}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-destructive">
          {t(failure)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || exercises.isPending}>
          {t('workoutGroups.save')}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
          {t('workouts.cancel')}
        </Button>
      </div>
    </form>
  )
}
