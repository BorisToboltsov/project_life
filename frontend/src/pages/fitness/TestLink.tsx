import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ExercisePreset } from '@/api/exercises'
import { useFitnessResults } from '@/api/fitness'
import { isoToDisplay } from '@/lib/dates'
import type { FitnessTest } from '@/lib/fitness'

import { useHeadlineText } from './fitnessText'

/** Упражнения журнала, у которых есть свой тест. */
const TEST_OF: Partial<Record<ExercisePreset, FitnessTest>> = {
  push_up: 'push_ups',
  pull_up: 'pull_ups',
}

/**
 * Ссылка с карточки упражнения на его тест и последний результат. В рекорды упражнения
 * тест не входит (ADR 0021).
 */
export function TestLink({ preset }: { preset: ExercisePreset }) {
  const { t } = useTranslation()
  const results = useFitnessResults()
  const headline = useHeadlineText()
  const test = TEST_OF[preset]
  if (!test) return null
  const latest = results.data?.find((result) => result.test === test)
  return (
    <Link
      to="/workouts/tests/$test"
      params={{ test }}
      className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card px-4 hover:bg-muted/50"
    >
      <span className="font-medium">
        {latest
          ? t('fitness.onExercise', {
              result: `${headline(latest)} · ${isoToDisplay(latest.local_date)}`,
            })
          : t('fitness.onExerciseNever')}
      </span>
      <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}
