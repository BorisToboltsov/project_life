import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { type FitnessResult, useFitnessResults } from '@/api/fitness'
import { useUser } from '@/auth/useSession'
import { PendingMark } from '@/components/PendingMark'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import { FITNESS_TESTS, rate } from '@/lib/fitness'
import { useOfflineState } from '@/offline/store'

import { rawOf, useHeadlineText, useRatingText, useRawText } from './fitnessText'

/** Под названием теста: дата и то, чего нет в главном числе, — дистанция или вариант. */
function useSubline(): (result: FitnessResult) => string {
  const { t } = useTranslation()
  const raw = useRawText()
  return (result) => {
    const date = isoToDisplay(result.local_date)
    if (result.test === 'cooper') return `${raw(rawOf(result))} · ${date}`
    if (result.variant) return `${t(`pushUpVariants.${result.variant}`)} · ${date}`
    return date
  }
}

/**
 * Карточка «Тесты» на экране тренировок (ADR 0021): по строке на тест — последний
 * результат, дата и оценка по нормам. Строка ведёт на экран теста.
 */
export function FitnessCard() {
  const { t } = useTranslation()
  const user = useUser()
  const results = useFitnessResults()
  const { pending } = useOfflineState()
  const headline = useHeadlineText()
  const ratingText = useRatingText()
  const subline = useSubline()

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('fitness.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label={t('fitness.title')} className="grid divide-y">
          {FITNESS_TESTS.map((test) => {
            const latest = results.data?.find((result) => result.test === test)
            const rated = latest ? rate(latest, user) : undefined
            return (
              <li key={test}>
                <Link
                  to="/workouts/tests/$test"
                  params={{ test }}
                  className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-muted/50"
                >
                  <span className="grid">
                    <span className="font-medium">{t(`fitnessTests.${test}`)}</span>
                    <span className="text-sm text-muted-foreground">
                      {latest ? subline(latest) : t('fitness.never')}
                    </span>
                  </span>
                  {latest && (
                    <span className="grid justify-items-end text-right">
                      <span className="flex items-center gap-1.5 font-medium">
                        {pending.has(latest.id) && <PendingMark />}
                        {headline(latest)}
                      </span>
                      {rated && 'rating' in rated && (
                        <span className="text-sm text-muted-foreground">
                          {ratingText(rated.rating).level}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
