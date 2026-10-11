import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type DayMeal,
  deleteEntry,
  deleteMeal,
  DIARY_KEY,
  type DiaryDay,
  type FoodEntry,
  useDiaryDay,
} from '@/api/nutrition'
import { DateField } from '@/components/form/DateField'
import { FormError } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { isRealDate, shiftDays, today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { formatGrams, formatKcal } from '@/lib/nutrition'

import { useMealName } from './mealName'
import { Measure } from './Measure'
import { DATE_MIN } from './values'

function DayNav({ date }: { date: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Что набрано в поле: дата открытого дня, пока её не начали править.
  const [typed, setTyped] = useState(date)

  return (
    <div className="grid gap-2">
      <div className="flex items-end gap-2">
        <Button
          asChild
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('diary.previousDay')}
        >
          <Link to="/diary/$date" params={{ date: shiftDays(date, -1) }}>
            <ChevronLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="flex-1">
          <DateField
            label={t('diary.date')}
            value={typed}
            min={DATE_MIN}
            // Переходим, только когда дата дописана: недописанная остаётся в поле.
            onChange={(iso) => {
              setTyped(iso)
              if (isRealDate(iso) && iso >= DATE_MIN) {
                void navigate({ to: '/diary/$date', params: { date: iso } })
              }
            }}
          />
        </div>
        <Button
          asChild
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('diary.nextDay')}
        >
          <Link to="/diary/$date" params={{ date: shiftDays(date, 1) }}>
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {date !== today() && (
        <Link
          to="/diary/$date"
          params={{ date: today() }}
          className="justify-self-start text-sm underline underline-offset-4"
        >
          {t('diary.toToday')}
        </Link>
      )}
    </div>
  )
}

function Summary({ day }: { day: DiaryDay }) {
  const { t } = useTranslation()
  const { totals, goal } = day

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('diary.summaryTitle')}</CardTitle>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link to="/diary/goal">{goal ? t('diary.goalChange') : t('diary.goalSet')}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Measure
          label={t('nutrients.kcal')}
          unit="kcal"
          eaten={totals.kcal}
          goal={goal?.kcal ?? undefined}
          prominent
        />
        <div className="grid grid-cols-3 gap-3">
          <Measure
            label={t('nutrients.protein')}
            unit="grams"
            eaten={totals.protein_g}
            goal={goal?.protein_g ?? undefined}
          />
          <Measure
            label={t('nutrients.fat')}
            unit="grams"
            eaten={totals.fat_g}
            goal={goal?.fat_g ?? undefined}
          />
          <Measure
            label={t('nutrients.carbs')}
            unit="grams"
            eaten={totals.carbs_g}
            goal={goal?.carbs_g ?? undefined}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function EntryRow({ entry }: { entry: FoodEntry }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteEntry(entry.id)
    if (result.failure) setFailure(result.failure)
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
  }

  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">{entry.product_name}</p>
          <p className="text-sm text-muted-foreground">
            {t('diary.entryLine', {
              amount: formatGrams(entry.amount, i18n.language),
              unit: t(`productUnits.${entry.unit}`),
              kcal: formatKcal(entry.kcal, i18n.language),
            })}
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">{t('diary.deleteConfirm')}</span>
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              {t('diary.deleteYes')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('diary.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button asChild variant="ghost" size="icon" aria-label={t('diary.edit')}>
              <Link to="/diary/$date/entries/$id" params={{ date: entry.local_date, id: entry.id }}>
                <Pencil aria-hidden="true" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('diary.delete')}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <FormError failure={failure} />
    </li>
  )
}

/** Под записями приёма пищи: копирование из другого дня и удаление приёма из списка. */
function MealActions({ date, meal, name }: { date: string; meal: DayMeal; name: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteMeal(meal.id)
    if (result.failure) setFailure(result.failure)
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
  }

  return (
    <div className="grid gap-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t('diary.mealDeleteConfirm')}</span>
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            {t('diary.deleteYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            {t('diary.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/diary/$date/copy/$scope"
            params={{ date, scope: meal.id }}
            className="text-sm underline underline-offset-4"
          >
            {t('diary.copyMeal')}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('diary.mealDelete', { meal: name })}
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      )}
      <FormError failure={failure} />
    </div>
  )
}

function MealCard({ date, meal }: { date: string; meal: DayMeal }) {
  const { t, i18n } = useTranslation()
  const name = useMealName()(meal)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardDescription>
          {t('diary.kcal', { value: formatKcal(meal.totals.kcal, i18n.language) })}
        </CardDescription>
        {!meal.archived && (
          <CardAction>
            <Button asChild className="h-11">
              <Link
                to="/diary/$date/add/$meal"
                params={{ date, meal: meal.id }}
                aria-label={t('diary.addTo', { meal: name })}
              >
                {t('diary.add')}
              </Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {meal.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('diary.emptyMeal')}</p>
        ) : (
          <ul aria-label={name} className="grid gap-2">
            {meal.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
        {/* Убранный из списка приём остаётся в дне ради своих записей: новое в него не вносят. */}
        {meal.archived ? (
          <p className="text-sm text-muted-foreground">{t('diary.mealArchived')}</p>
        ) : (
          <MealActions date={date} meal={meal} name={name} />
        )}
      </CardContent>
    </Card>
  )
}

const route = getRouteApi('/app/diary/$date')

export function DiaryPage() {
  const { t } = useTranslation()
  const { date } = route.useParams() as { date: string }
  const day = useDiaryDay(date)

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('diary.title')}</h1>
      {/* Ключ сбрасывает набранное в поле даты, когда открыт другой день. */}
      <DayNav key={date} date={date} />
      {day.data ? (
        <>
          <Summary day={day.data} />
          {day.data.meals.map((meal) => (
            <MealCard key={meal.id} date={date} meal={meal} />
          ))}
          {day.data.meals.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('diary.noMeals')}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="h-11">
              <Link to="/diary/$date/meals/new" params={{ date }}>
                <Plus aria-hidden="true" />
                {t('diary.mealAdd')}
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link to="/diary/$date/copy/$scope" params={{ date, scope: 'day' }}>
                {t('diary.copyDay')}
              </Link>
            </Button>
            <Button asChild variant="ghost" className="h-11">
              <Link to="/products">{t('diary.catalog')}</Link>
            </Button>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      )}
    </div>
  )
}
