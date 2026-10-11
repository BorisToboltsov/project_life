import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DIARY_KEY, type FoodEntry, MEALS, saveEntry, useDiaryDay } from '@/api/nutrition'
import { FormError, SelectField, TextField } from '@/components/form/fields'
import { numberOf } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'

import { amountSchema } from './values'

const schema = amountSchema.extend({ meal: z.enum(MEALS) })

type Values = z.infer<typeof schema>

function EditForm({ entry }: { entry: FoodEntry }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: String(entry.amount_g), meal: entry.meal },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: Values) {
    setFailure(undefined)
    const result = await saveEntry(entry.id, {
      local_date: entry.local_date,
      meal: values.meal,
      // Продукт тот же — запись остаётся со своим снимком состава.
      product_id: entry.product_id,
      amount_g: numberOf(values.amount, 1),
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    await navigate({ to: '/diary/$date', params: { date: entry.local_date } })
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">
        {t('entry.editTitle')}: {entry.product_name}
      </h1>
      <FormError failure={failure} />
      <TextField
        label={t('entry.amount')}
        inputMode="decimal"
        autoComplete="off"
        error={errors.amount?.message}
        {...form.register('amount')}
      />
      <SelectField label={t('entry.meal')} {...form.register('meal')}>
        {MEALS.map((meal) => (
          <option key={meal} value={meal}>
            {t(`meals.${meal}`)}
          </option>
        ))}
      </SelectField>
      <div className="flex gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
        <Button asChild variant="ghost" className="h-11">
          <Link to="/diary/$date" params={{ date: entry.local_date }}>
            {t('diary.cancel')}
          </Link>
        </Button>
      </div>
    </form>
  )
}

const route = getRouteApi('/app/diary/$date/entries/$id')

export function EntryEditPage() {
  const { t } = useTranslation()
  const { date, id } = route.useParams() as { date: string; id: string }
  const day = useDiaryDay(date)
  const entry = day.data?.meals.flatMap((meal) => meal.entries).find((item) => item.id === id)

  if (day.isPending) {
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
  return <EditForm entry={entry} />
}
