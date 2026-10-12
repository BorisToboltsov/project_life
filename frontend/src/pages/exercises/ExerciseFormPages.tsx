import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type Exercise, EXERCISES_KEY, saveExercise, useExercises } from '@/api/exercises'
import { CheckChip } from '@/components/form/CheckChip'
import { ChoiceChip } from '@/components/form/ChoiceChip'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'

import { KINDS, MUSCLES } from './exerciseText'
import { exerciseSchema, type ExerciseValues } from './exerciseValues'

/**
 * Форма своего упражнения: название, что записывает подход и какие мышцы работают.
 * `exercise` — упражнение, которое правят; без него форма заводит новое.
 */
function ExerciseForm({ exercise }: { exercise?: Exercise }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(exercise?.id ?? uuidv7())
  const form = useForm<ExerciseValues>({
    resolver: zodResolver(exerciseSchema),
    defaultValues: {
      name: exercise?.name ?? '',
      kind: exercise?.kind ?? 'weight_reps',
      muscles: exercise?.muscles ?? [],
    },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: ExerciseValues) {
    setFailure(undefined)
    const result = await saveExercise(id.current, values)
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: EXERCISES_KEY })
    await navigate({ to: '/workouts/exercises/$key', params: { key: id.current } })
  }

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={(event) => void form.handleSubmit(submit)(event)}
          noValidate
          className="grid gap-4"
        >
          <FormError failure={failure} />
          <TextField
            label={t('exerciseForm.name')}
            autoComplete="off"
            hint={t('exerciseForm.nameHint')}
            error={errors.name?.message}
            {...form.register('name')}
          />
          <fieldset className="grid gap-2" disabled={exercise !== undefined}>
            <legend className="mb-2 text-sm font-medium">{t('exerciseForm.kind')}</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((kind) => (
                <ChoiceChip key={kind} value={kind} {...form.register('kind')}>
                  {t(`exerciseKinds.${kind}`)}
                </ChoiceChip>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{t('exerciseForm.kindFixed')}</p>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t('exerciseForm.muscles')}</legend>
            <div className="flex flex-wrap gap-2">
              {MUSCLES.map((muscle) => (
                <CheckChip key={muscle} value={muscle} {...form.register('muscles')}>
                  {t(`muscles.${muscle}`)}
                </CheckChip>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{t('exerciseForm.musclesHint')}</p>
          </fieldset>
          <Button type="submit" className="h-11 justify-self-start" disabled={isSubmitting}>
            {exercise ? t('common.save') : t('exerciseForm.create')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ToList() {
  const { t } = useTranslation()
  return (
    <Button asChild variant="ghost" className="h-11 justify-self-start">
      <Link to="/workouts/exercises">{t('exercises.toList')}</Link>
    </Button>
  )
}

/** Новое своё упражнение: оно встаёт в конец списка. */
export function ExerciseNewPage() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('exerciseForm.newTitle')}</h1>
      <ExerciseForm />
      <ToList />
    </div>
  )
}

/** Правка своего упражнения: название и мышцы; что записывает подход, уже не изменить. */
export function ExerciseEditPage() {
  const { t } = useTranslation()
  const { key } = useParams({ from: '/app/workouts/exercises/$key/edit' })
  const exercises = useExercises()

  if (exercises.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  // Штатное упражнение не правят: его название и мышцы заданы справочником.
  const exercise = exercises.data?.exercises.find((item) => item.id === key && !item.preset)
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('exerciseForm.editTitle')}</h1>
      {exercise ? (
        <ExerciseForm exercise={exercise} />
      ) : (
        <p className="text-muted-foreground">{t('exercises.notFound')}</p>
      )}
      <ToList />
    </div>
  )
}
