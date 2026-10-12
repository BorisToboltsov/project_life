import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Plus, Search } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  addPresetExercise,
  type Exercise,
  type ExercisePreset,
  EXERCISES_KEY,
  saveExercise,
  useExercises,
} from '@/api/exercises'
import { FormError } from '@/components/form/fields'
import { ExerciseFigure } from '@/components/illustrations/exercise/ExerciseFigure'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ErrorKey } from '@/lib/errors'
import { cn } from '@/lib/utils'

import {
  type Group,
  GROUPS,
  inGroup,
  type Shown,
  useExerciseName,
  useMuscleList,
} from './exerciseText'

/** Строка списка: миниатюра, название и мышцы ведут на карточку; справа — действие. */
function Row({
  to,
  exercise,
  note,
  action,
}: {
  /** Ключ в адресе карточки: код штатного упражнения или ключ своего. */
  to: string
  exercise: Shown
  /** Вторая строка, если это не мышцы. */
  note?: string
  action: ReactNode
}) {
  const name = useExerciseName()
  const muscles = useMuscleList()
  return (
    <li className="flex items-center gap-2 rounded-lg border p-2">
      <Link
        to="/workouts/exercises/$key"
        params={{ key: to }}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3"
      >
        <span className="w-12 shrink-0 rounded-md bg-muted">
          <ExerciseFigure preset={exercise.preset} still />
        </span>
        <span className="grid min-w-0">
          <span className="font-medium">{name(exercise)}</span>
          <span className="text-sm text-muted-foreground">{note ?? muscles(exercise.muscles)}</span>
        </span>
      </Link>
      {action}
    </li>
  )
}

/**
 * Список упражнений: сверху свои и добавленные, ниже — справочник, из которого упражнение
 * добавляется одним касанием. Поиск и метки групп мышц сужают оба списка.
 */
export function ExercisesPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const exercises = useExercises()
  const name = useExerciseName()
  const muscles = useMuscleList()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<Group>('all')
  const [added, setAdded] = useState<string>()
  const [failure, setFailure] = useState<ErrorKey>()

  async function settle(result: { failure?: ErrorKey }, label: string) {
    setFailure(result.failure)
    setAdded(result.failure ? undefined : label)
    await queryClient.invalidateQueries({ queryKey: EXERCISES_KEY })
  }
  const addPreset = async (preset: ExercisePreset) =>
    settle(await addPresetExercise(preset), t(`exerciseNames.${preset}`))
  const restore = async (exercise: Exercise) =>
    settle(
      await saveExercise(exercise.id, {
        name: name(exercise),
        kind: exercise.kind,
        muscles: exercise.muscles,
      }),
      name(exercise),
    )

  if (exercises.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const all = exercises.data?.exercises ?? []
  const needle = query.trim().toLocaleLowerCase(i18n.language)
  const fits = (exercise: Shown) =>
    inGroup(exercise, group) && name(exercise).toLocaleLowerCase(i18n.language).includes(needle)
  const mine = all.filter((exercise) => !exercise.archived)
  const listed = new Set(mine.map((exercise) => exercise.preset))
  // Убранное штатное упражнение снова стоит в справочнике; отдельным списком — только свои.
  const removed = all.filter((exercise) => exercise.archived && !exercise.preset && fits(exercise))
  const catalog = (exercises.data?.catalog ?? [])
    .filter((exercise) => !listed.has(exercise.preset))
    .map((exercise) => ({ ...exercise, name: null }))
    .filter(fits)
  const shown = mine.filter(fits)
  const filtered = needle !== '' || group !== 'all'
  const chevron = <ChevronRight aria-hidden="true" className="size-5 text-muted-foreground" />

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('exercises.title')}</h1>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label={t('exercises.search')}
          placeholder={t('exercises.search')}
          className="h-11 pl-10 text-base"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ul aria-label={t('exercises.groups')} className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {GROUPS.map((item) => (
          <li key={item} className="shrink-0">
            <button
              type="button"
              aria-pressed={group === item}
              onClick={() => setGroup(item)}
              className={cn(
                'h-11 rounded-full border px-4 text-sm',
                group === item && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              {t(`muscleGroups.${item}`)}
            </button>
          </li>
        ))}
      </ul>
      <FormError failure={failure} />
      {added && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('exercises.added', { name: added })}
        </p>
      )}
      <section className="grid gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t('exercises.mine')}</h2>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(filtered ? 'exercises.nothingFound' : 'exercises.mineEmpty')}
          </p>
        ) : (
          <ul aria-label={t('exercises.mine')} className="grid gap-2">
            {shown.map((exercise) => (
              <Row
                key={exercise.id}
                to={exercise.preset ?? exercise.id}
                exercise={exercise}
                note={
                  exercise.preset
                    ? undefined
                    : [
                        t('exercises.ownTag'),
                        muscles(exercise.muscles).toLocaleLowerCase(i18n.language),
                      ]
                        .filter(Boolean)
                        .join(' · ')
                }
                action={chevron}
              />
            ))}
          </ul>
        )}
      </section>
      {catalog.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('exercises.catalog')}</h2>
          <ul aria-label={t('exercises.catalog')} className="grid gap-2">
            {catalog.map((exercise) => (
              <Row
                key={exercise.preset}
                to={exercise.preset}
                exercise={exercise}
                action={
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0 rounded-full"
                    aria-label={t('exercises.add', { name: name(exercise) })}
                    onClick={() => void addPreset(exercise.preset)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      )}
      {removed.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t('exercises.removed')}</h2>
          <ul aria-label={t('exercises.removed')} className="grid gap-2">
            {removed.map((exercise) => (
              <Row
                key={exercise.id}
                to={exercise.id}
                exercise={exercise}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 shrink-0"
                    aria-label={t('exercises.restoreNamed', { name: name(exercise) })}
                    onClick={() => void restore(exercise)}
                  >
                    {t('exercises.restore')}
                  </Button>
                }
              />
            ))}
          </ul>
        </section>
      )}
      <Link
        to="/workouts/exercises/new"
        className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/50 p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <Plus aria-hidden="true" className="size-5" />
        {t('exercises.own')}
      </Link>
    </div>
  )
}
