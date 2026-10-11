import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DIARY_KEY, saveMeal } from '@/api/nutrition'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'

import { mealSchema, type MealValues } from './values'

const route = getRouteApi('/app/diary/$date/meals/new')

/** Свой приём пищи: название. Он встаёт в конец дня и остаётся в списке на все дни. */
export function MealNewPage() {
  const { t } = useTranslation()
  const { date } = route.useParams() as { date: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ приёма живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(uuidv7())
  const form = useForm<MealValues>({
    resolver: zodResolver(mealSchema),
    defaultValues: { name: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: MealValues) {
    setFailure(undefined)
    const result = await saveMeal(id.current, { name: values.name.trim() })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    await navigate({ to: '/diary/$date', params: { date } })
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">{t('meal.newTitle')}</h1>
      <FormError failure={failure} />
      <TextField
        label={t('meal.name')}
        autoComplete="off"
        hint={t('meal.nameHint')}
        error={errors.name?.message}
        {...form.register('name')}
      />
      <div className="flex gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
        <Button asChild variant="ghost" className="h-11">
          <Link to="/diary/$date" params={{ date }}>
            {t('diary.cancel')}
          </Link>
        </Button>
      </div>
    </form>
  )
}
