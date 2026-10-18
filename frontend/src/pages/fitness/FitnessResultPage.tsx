import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FITNESS_KEY,
  type FitnessResult,
  saveFitnessResult,
  useFitnessResults,
} from '@/api/fitness'
import { useUser } from '@/auth/useSession'
import { ChoiceChip } from '@/components/form/ChoiceChip'
import { DateField } from '@/components/form/DateField'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import type { FitnessTest } from '@/lib/fitness'
import { uuidv7 } from '@/lib/uuid'
import { DATE_MIN } from '@/pages/measurements/entryValues'

import { testOf } from './fitnessText'
import {
  distanceUnit,
  resultBody,
  resultDefaults,
  resultSchema,
  type ResultValues,
} from './resultValues'

const VARIANTS = ['classic', 'knee'] as const

function ResultForm({ test, item }: { test: FitnessTest; item?: FitnessResult }) {
  const { t } = useTranslation()
  const user = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(item?.id ?? uuidv7())
  // Правка остаётся в единице, в которой результат вносили.
  const unit = item?.distance_unit ?? distanceUnit(user.unit_system)
  const form = useForm<ResultValues>({
    resolver: zodResolver(resultSchema(test, unit)),
    defaultValues: resultDefaults(item, user.sex === 'female' ? 'knee' : 'classic'),
  })
  const { errors, isSubmitting } = form.formState
  const name = t(`fitnessTests.${test}`)

  async function submit(values: ResultValues) {
    setFailure(undefined)
    const result = await saveFitnessResult(id.current, resultBody(test, values, unit, item))
    await queryClient.invalidateQueries({ queryKey: FITNESS_KEY })
    if (result.failure) return setFailure(result.failure)
    await navigate({ to: '/workouts/tests/$test', params: { test } })
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">
        {t(item ? 'fitness.editTitle' : 'fitness.newTitle', { test: name })}
      </h1>
      <FormError failure={failure} />
      <Controller
        name="date"
        control={form.control}
        render={({ field }) => (
          <DateField
            label={t('fitness.date')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            min={DATE_MIN}
            max={today()}
            error={errors.date?.message}
          />
        )}
      />
      {test === 'push_ups' && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{t('fitness.variant')}</legend>
          <div className="flex flex-wrap gap-2">
            {VARIANTS.map((variant) => (
              <ChoiceChip
                key={variant}
                value={variant}
                disabled={item !== undefined}
                {...form.register('variant')}
              >
                {t(`pushUpVariants.${variant}`)}
              </ChoiceChip>
            ))}
          </div>
          {item && <p className="text-sm text-muted-foreground">{t('fitness.variantFixed')}</p>}
        </fieldset>
      )}
      {test === 'cooper' ? (
        <TextField
          label={t('fitness.distance')}
          inputMode="decimal"
          autoComplete="off"
          suffix={t(`unitNames.${unit}`)}
          error={errors.distance?.message}
          {...form.register('distance')}
        />
      ) : (
        <TextField
          label={t('fitness.reps')}
          inputMode="numeric"
          autoComplete="off"
          error={errors.reps?.message}
          {...form.register('reps')}
        />
      )}
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {t('common.save')}
      </Button>
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/workouts/tests/$test" params={{ test }}>
          {t('fitness.cancel')}
        </Link>
      </Button>
    </form>
  )
}

function UnknownTest() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('fitness.title')}</h1>
      <p className="text-muted-foreground">{t('fitness.unknownTest')}</p>
    </div>
  )
}

/** Новый результат теста. */
export function FitnessResultNewPage() {
  const test = testOf(useParams({ from: '/app/workouts/tests/$test/new' }).test)
  return test ? <ResultForm test={test} /> : <UnknownTest />
}

/** Правка результата: дата и значение; вариант отжиманий не меняется (инвариант I21). */
export function FitnessResultEditPage() {
  const { t } = useTranslation()
  const params = useParams({ from: '/app/workouts/tests/$test/$id' })
  const test = testOf(params.test)
  const results = useFitnessResults()
  if (!test) return <UnknownTest />
  if (results.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>
  const item = results.data?.find((result) => result.id === params.id && result.test === test)
  if (!item) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t(`fitnessTests.${test}`)}</h1>
        <p className="text-muted-foreground">{t('fitness.notFound')}</p>
        <Button asChild variant="ghost" className="h-11 justify-self-start">
          <Link to="/workouts/tests/$test" params={{ test }}>
            {t('fitness.toTests')}
          </Link>
        </Button>
      </div>
    )
  }
  return <ResultForm test={test} item={item} />
}
