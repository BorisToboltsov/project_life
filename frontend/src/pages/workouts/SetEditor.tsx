import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkoutExercise, WorkoutSet, WorkoutSetInput } from '@/api/workouts'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { displayUnit, fromCanonical } from '@/lib/units'
import { uuidv7 } from '@/lib/uuid'

interface Props {
  item: WorkoutExercise
  editing?: WorkoutSet
  onSave: (body: WorkoutSetInput, id: string) => Promise<void>
  onCancel?: () => void
  busy: boolean
}

function initialValue(
  item: WorkoutExercise,
  editing: WorkoutSet | undefined,
): WorkoutSet | undefined {
  return editing ?? item.sets.at(-1) ?? item.previous.at(-1)
}

export function SetEditor({ item, editing, onSave, onCancel, busy }: Props) {
  const { t } = useTranslation()
  const user = useUser()
  const previous = initialValue(item, editing)
  const newId = useRef(uuidv7())
  const weightUnit = displayUnit('mass', user.unit_system) as 'kg' | 'lb'
  const distanceUnit = user.unit_system === 'imperial' ? 'mi' : 'km'
  const weightInitial =
    previous?.weight_kg == null
      ? 0
      : previous.weight_unit === weightUnit
        ? (previous.weight_value ?? 0)
        : fromCanonical(previous.weight_kg, weightUnit)
  const distanceInitial =
    previous?.distance_km == null
      ? 0
      : previous.distance_unit === distanceUnit
        ? (previous.distance_value ?? 0)
        : Math.round((previous.distance_km / (distanceUnit === 'mi' ? 1.609344 : 1)) * 10) / 10
  const [reps, setReps] = useState(String(previous?.reps ?? 10))
  const [weight, setWeight] = useState(String(weightInitial))
  const [duration, setDuration] = useState(String(previous?.duration_seconds ?? 60))
  const [distance, setDistance] = useState(String(distanceInitial))
  const [incline, setIncline] = useState(String(previous?.incline_percent ?? 0))
  const [level, setLevel] = useState(String(previous?.level ?? 1))
  const [invalid, setInvalid] = useState(false)
  const kind = item.exercise.kind

  function number(text: string): number {
    return Number(text.replace(',', '.'))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body: WorkoutSetInput = {}
    if (kind === 'weight_reps' || kind === 'reps') body.reps = number(reps)
    if (kind === 'weight_reps') {
      body.weight_value = number(weight)
      body.weight_unit = weightUnit
    }
    if (kind === 'time' || kind === 'cardio') body.duration_seconds = number(duration)
    if (kind === 'cardio') {
      if (
        item.exercise.cardio_fields.includes('distance') &&
        distance.trim() !== '' &&
        number(distance) > 0
      ) {
        body.distance_value = number(distance)
        body.distance_unit = distanceUnit
      }
      if (item.exercise.cardio_fields.includes('incline') && incline.trim() !== '')
        body.incline_percent = number(incline)
      if (item.exercise.cardio_fields.includes('level') && level.trim() !== '')
        body.level = number(level)
    }
    const all = [
      body.reps,
      body.weight_value,
      body.duration_seconds,
      body.distance_value,
      body.incline_percent,
      body.level,
    ]
    const invalidNumber = all.some(
      (value) => value !== undefined && !Number.isFinite(Number(value)),
    )
    if (
      invalidNumber ||
      (body.reps != null && body.reps <= 0) ||
      (body.duration_seconds != null && body.duration_seconds <= 0) ||
      (body.weight_value !== undefined && Number(body.weight_value) < 0)
    ) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    await onSave(body, editing?.id ?? newId.current)
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-4 rounded-xl border bg-card p-4"
    >
      <h3 className="font-medium">{t(editing ? 'workouts.editSet' : 'workouts.addSet')}</h3>
      {kind === 'weight_reps' && (
        <Stepper
          label={`${t('workouts.weight')}, ${t(`unitNames.${weightUnit}`)}`}
          value={weight}
          onChange={setWeight}
          step={2.5}
          min={0}
        />
      )}
      {(kind === 'weight_reps' || kind === 'reps') && (
        <Stepper label={t('workouts.reps')} value={reps} onChange={setReps} step={1} min={1} />
      )}
      {(kind === 'time' || kind === 'cardio') && (
        <Stepper
          label={t('workouts.duration')}
          value={duration}
          onChange={setDuration}
          step={10}
          min={1}
        />
      )}
      {kind === 'cardio' && item.exercise.cardio_fields.includes('distance') && (
        <Stepper
          label={`${t('workouts.distance')}, ${t(`unitNames.${distanceUnit}`)}`}
          value={distance}
          onChange={setDistance}
          step={0.1}
          min={0}
        />
      )}
      {kind === 'cardio' && item.exercise.cardio_fields.includes('incline') && (
        <Stepper
          label={t('workouts.incline')}
          value={incline}
          onChange={setIncline}
          step={0.5}
          min={0}
        />
      )}
      {kind === 'cardio' && item.exercise.cardio_fields.includes('level') && (
        <Stepper label={t('workouts.level')} value={level} onChange={setLevel} step={1} min={1} />
      )}
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t('workouts.invalidValue')}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="h-11 flex-1">
          {t('workouts.saveSet')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
            {t('workouts.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}

function Stepper({
  label,
  value,
  onChange,
  step,
  min,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  step: number
  min: number
}) {
  const { t } = useTranslation()
  const adjust = (direction: number) => {
    const current = Number(value.replace(',', '.')) || 0
    onChange(String(Math.round(Math.max(min, current + direction * step) * 100) / 100))
  }
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-12 text-xl"
          aria-label={t('workouts.stepDown', { field: label })}
          onClick={() => adjust(-1)}
        >
          −
        </Button>
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min={min}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="h-12 min-w-0 flex-1 text-center text-xl tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          className="size-12 text-xl"
          aria-label={t('workouts.stepUp', { field: label })}
          onClick={() => adjust(1)}
        >
          +
        </Button>
      </div>
    </div>
  )
}
