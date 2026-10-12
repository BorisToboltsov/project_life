import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  addPresetExercise,
  deleteExercise,
  type Exercise,
  type ExercisePreset,
  EXERCISES_KEY,
  saveExercise,
  useExercises,
} from '@/api/exercises'
import type { Schemas } from '@/api/client'
import { FormError } from '@/components/form/fields'
import { ExerciseFigure } from '@/components/illustrations/exercise/ExerciseFigure'
import { MuscleMap } from '@/components/illustrations/exercise/MuscleMap'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ErrorKey } from '@/lib/errors'

import { type Shown, useExerciseName, useMuscleList, useSteps } from './exerciseText'

/** Упражнение карточки: что показать и строка из списка пользователя, если она есть. */
interface Subject {
  shown: Shown & { cardio_fields: Schemas['CardioField'][] }
  /** Строка в списке пользователя: её нет у штатного упражнения, которое ещё не добавляли. */
  row?: Exercise
  preset: ExercisePreset | null
}

function BackToList() {
  const { t } = useTranslation()
  return (
    <Button asChild variant="ghost" className="h-11 justify-self-start">
      <Link to="/workouts/exercises">{t('exercises.toList')}</Link>
    </Button>
  )
}

/**
 * Карточка упражнения: рисунок техники и карта мышц рядом, ниже — какие мышцы работают и
 * шаги техники. Адрес несёт код штатного упражнения или ключ своего.
 */
export function ExercisePage() {
  const { t } = useTranslation()
  const { key } = useParams({ from: '/app/workouts/exercises/$key' })
  const queryClient = useQueryClient()
  const exercises = useExercises()
  const name = useExerciseName()
  const muscles = useMuscleList()
  const steps = useSteps()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  if (exercises.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const rows = exercises.data?.exercises ?? []
  const preset = (exercises.data?.catalog ?? []).find((exercise) => exercise.preset === key)
  const row = rows.find((exercise) => (preset ? exercise.preset === key : exercise.id === key))
  const subject: Subject | undefined = preset
    ? { shown: { ...preset, name: null }, row, preset: preset.preset }
    : row && { shown: row, row, preset: null }

  if (!subject) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('exercises.title')}</h1>
        <p className="text-muted-foreground">{t('exercises.notFound')}</p>
        <BackToList />
      </div>
    )
  }
  const { shown } = subject
  const title = name(shown)
  const inList = subject.row !== undefined && !subject.row.archived

  async function settle(result: { failure?: ErrorKey }) {
    setFailure(result.failure)
    setConfirming(false)
    await queryClient.invalidateQueries({ queryKey: EXERCISES_KEY })
  }
  const add = async () => {
    if (subject.preset) return settle(await addPresetExercise(subject.preset))
    if (subject.row) {
      const { id, kind } = subject.row
      return settle(await saveExercise(id, { name: title, kind, muscles: subject.row.muscles }))
    }
  }
  const remove = async () => subject.row && settle(await deleteExercise(subject.row.id))

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <ul className="flex flex-wrap gap-2 text-sm">
        <li className="rounded-full border px-3 py-1">{t(`exerciseKinds.${shown.kind}`)}</li>
        {!subject.preset && (
          <li className="rounded-full border px-3 py-1">{t('exercises.ownTag')}</li>
        )}
      </ul>
      <FormError failure={failure} />
      {subject.row?.archived && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('exercises.outOfList')}
        </p>
      )}
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-2">
              <ExerciseFigure preset={subject.preset} />
            </div>
            {shown.muscles.length > 0 && (
              <div className="rounded-lg bg-muted p-2">
                <MuscleMap main={shown.muscles} help={shown.secondary} />
              </div>
            )}
          </div>
          {shown.muscles.length > 0 && (
            <dl className="grid gap-1 text-sm">
              <div>
                <dt className="inline font-medium">{t('exercises.work')}: </dt>
                <dd className="inline">{muscles(shown.muscles).toLocaleLowerCase()}</dd>
              </div>
              {shown.secondary.length > 0 && (
                <div>
                  <dt className="inline font-medium">{t('exercises.help')}: </dt>
                  <dd className="inline">{muscles(shown.secondary).toLocaleLowerCase()}</dd>
                </div>
              )}
            </dl>
          )}
          {shown.kind === 'cardio' && (
            <p className="text-sm">
              <span className="font-medium">{t('exercises.records')}: </span>
              {[
                t('exercises.time'),
                ...shown.cardio_fields.map((field) => t(`cardioFields.${field}`)),
              ].join(', ')}
            </p>
          )}
          {subject.preset && (
            <section className="grid gap-2">
              <h2 className="text-sm font-medium">{t('exercises.technique')}</h2>
              <ol
                aria-label={t('exercises.technique')}
                className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground"
              >
                {steps(subject.preset).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          )}
        </CardContent>
      </Card>
      {confirming ? (
        <div className="grid gap-2">
          <p className="text-sm">{t('exercises.removeConfirm', { name: title })}</p>
          <div className="flex gap-2">
            <Button variant="destructive" className="h-11" onClick={() => void remove()}>
              {t('exercises.removeYes')}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setConfirming(false)}>
              {t('exercises.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-between gap-2">
          {inList ? (
            <>
              {subject.preset ? (
                <span />
              ) : (
                <Button asChild variant="ghost" className="h-11">
                  <Link to="/workouts/exercises/$key/edit" params={{ key }}>
                    <Pencil aria-hidden="true" />
                    {t('exercises.edit')}
                  </Link>
                </Button>
              )}
              <Button variant="ghost" className="h-11" onClick={() => setConfirming(true)}>
                <X aria-hidden="true" />
                {t('exercises.remove')}
              </Button>
            </>
          ) : (
            <Button className="h-11" onClick={() => void add()}>
              <Plus aria-hidden="true" />
              {t('exercises.addToList')}
            </Button>
          )}
        </div>
      )}
      <BackToList />
    </div>
  )
}
