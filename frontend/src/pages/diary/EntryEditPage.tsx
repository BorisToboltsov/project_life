import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  type DayMeal,
  DIARY_KEY,
  type FoodEntry,
  saveEntry,
  useDiaryDay,
  useProduct,
} from '@/api/nutrition'
import { FormError, SelectField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'
import { type PortionSizes, sizesOf } from '@/lib/portions'

import { useMealName } from './mealName'
import { checkQuantity, howMuch, type Quantity, quantityOf, quantityShape } from './quantity'
import { QuantityField } from './QuantityField'

type Values = Quantity & { meal: string }

function EditForm({
  entry,
  meals,
  sizes,
}: {
  entry: FoodEntry
  meals: DayMeal[]
  sizes: PortionSizes
}) {
  const { t } = useTranslation()
  const mealName = useMealName()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const form = useForm<Values>({
    resolver: zodResolver(
      z.object({ ...quantityShape, meal: z.string() }).superRefine(checkQuantity(sizes)),
    ),
    defaultValues: { ...quantityOf(entry), meal: entry.meal_id },
  })

  async function submit(values: Values) {
    setFailure(undefined)
    const result = await saveEntry(entry.id, {
      local_date: entry.local_date,
      meal_id: values.meal,
      // Продукт тот же — запись остаётся со своим снимком состава.
      product_id: entry.product_id,
      ...howMuch(values),
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    await navigate({ to: '/diary/$date', params: { date: entry.local_date } })
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        noValidate
        className="grid gap-4"
      >
        <h1 className="text-2xl font-semibold">
          {t('entry.editTitle')}: {entry.product_name}
        </h1>
        <FormError failure={failure} />
        {/* Калории на 100 единиц — из самой записи: она хранит состав на момент внесения. */}
        <QuantityField unit={entry.unit} sizes={sizes} kcal={(entry.kcal / entry.amount) * 100} />
        <SelectField label={t('entry.meal')} {...form.register('meal')}>
          {/* Приёмы из списка и тот, где запись лежит сейчас, даже если его из списка убрали. */}
          {meals
            .filter((meal) => !meal.archived || meal.id === entry.meal_id)
            .map((meal) => (
              <option key={meal.id} value={meal.id}>
                {mealName(meal)}
              </option>
            ))}
        </SelectField>
        <div className="flex gap-3">
          <Button type="submit" className="h-11" disabled={form.formState.isSubmitting}>
            {t('common.save')}
          </Button>
          <Button asChild variant="ghost" className="h-11">
            <Link to="/diary/$date" params={{ date: entry.local_date }}>
              {t('diary.cancel')}
            </Link>
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}

const route = getRouteApi('/app/diary/$date/entries/$id')

export function EntryEditPage() {
  const { t } = useTranslation()
  const { date, id } = route.useParams() as { date: string; id: string }
  const day = useDiaryDay(date)
  const meals = day.data?.meals ?? []
  const entry = meals.flatMap((meal) => meal.entries).find((item) => item.id === id)
  // Меры, на которые запись можно перевести, — у продукта каталога, если он ещё есть.
  const product = useProduct(entry?.product_id ?? undefined)

  if (day.isPending || product.isLoading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  if (!entry) {
    return (
      <div className="grid gap-4">
        <p>{t('entry.notFound')}</p>
        <Button asChild variant="outline" className="h-11 justify-self-start">
          <Link to="/diary/$date" params={{ date }}>
            {t('entry.back')}
          </Link>
        </Button>
      </div>
    )
  }
  const sizes = {
    ...(product.data && sizesOf(product.data)),
    // Своя мера записи — того размера, с каким её внесли: сервер считает по нему же.
    ...(entry.portion && { [entry.portion.kind]: entry.portion.size }),
  }
  return <EditForm entry={entry} meals={meals} sizes={sizes} />
}
