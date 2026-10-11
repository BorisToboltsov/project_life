import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { copyEntries, DIARY_KEY, useDiaryDay } from '@/api/nutrition'
import { DateField } from '@/components/form/DateField'
import { FormError } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { isoToDisplay, isRealDate, shiftDays } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { formatGrams, formatKcal } from '@/lib/nutrition'
import { uuidv7 } from '@/lib/uuid'

import { useMealName } from './mealName'
import { MealNotFound } from './MealNotFound'
import { DATE_MIN } from './values'

const route = getRouteApi('/app/diary/$date/copy/$scope')

/**
 * Копирование приёма пищи или целого дня из другого дня в открытый. `scope` в адресе —
 * ключ приёма пищи или `day`.
 */
export function CopyPage() {
  const { t, i18n } = useTranslation()
  const { date, scope } = route.useParams() as { date: string; scope: string }
  const mealName = useMealName()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [from, setFrom] = useState(() => shiftDays(date, -1))
  const [failure, setFailure] = useState<ErrorKey>()
  const [copying, setCopying] = useState(false)
  // Ключи копий живут, пока открыт экран: повторная отправка после сбоя не создаст дубли.
  const ids = useRef(new Map<string, string>())
  const valid = isRealDate(from) && from >= DATE_MIN
  const target = useDiaryDay(date)
  const source = useDiaryDay(valid ? from : date)
  const into = target.data?.meals.find((meal) => meal.id === scope)
  // Что копируется: записи вместе с приёмом пищи, из которого они берутся.
  const copied = valid
    ? (source.data?.meals ?? [])
        .filter((meal) => scope === 'day' || meal.id === scope)
        .flatMap((meal) => meal.entries.map((entry) => ({ entry, meal })))
    : []
  const entries = copied.map(({ entry }) => entry)

  async function copy() {
    setFailure(undefined)
    setCopying(true)
    const result = await copyEntries({
      to_date: date,
      to_meal_id: scope === 'day' ? null : scope,
      items: entries.map((entry) => {
        const id = ids.current.get(entry.id) ?? uuidv7()
        ids.current.set(entry.id, id)
        return { source_id: entry.id, id }
      }),
    })
    setCopying(false)
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    await navigate({ to: '/diary/$date', params: { date } })
  }

  if (scope !== 'day' && !into) {
    return target.isPending ? (
      <p className="text-muted-foreground">{t('common.loading')}</p>
    ) : (
      <MealNotFound date={date} />
    )
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">
        {t('copy.title', { what: into ? mealName(into) : t('copy.day') })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t('copy.into', { date: isoToDisplay(date) })}
      </p>
      <DateField label={t('copy.from')} value={from} min={DATE_MIN} onChange={setFrom} />
      <FormError failure={failure} />
      {valid && source.isSuccess && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('copy.empty')}</p>
      )}
      <ul aria-label={t('copy.preview')} className="grid gap-2">
        {copied.map(({ entry, meal }) => (
          <li key={entry.id} className="rounded-lg border p-3">
            <p className="font-medium break-words">{entry.product_name}</p>
            <p className="text-sm text-muted-foreground">
              {mealName(meal)}
              {' · '}
              {t('diary.entryLine', {
                amount: formatGrams(entry.amount, i18n.language),
                unit: t(`productUnits.${entry.unit}`),
                kcal: formatKcal(entry.kcal, i18n.language),
              })}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button
          className="h-11"
          disabled={entries.length === 0 || copying}
          onClick={() => void copy()}
        >
          {t('copy.submit')}
        </Button>
        <Button asChild variant="ghost" className="h-11">
          <Link to="/diary/$date" params={{ date }}>
            {t('diary.cancel')}
          </Link>
        </Button>
      </div>
    </div>
  )
}
