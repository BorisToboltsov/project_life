import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { useMetrics } from '@/api/measurements'
import { PRESSURE_KEY, savePressure, usePressureReadings } from '@/api/pressure'
import { useUser } from '@/auth/useSession'
import { DateField } from '@/components/form/DateField'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import type { PressureReading } from '@/lib/pressure'
import { uuidv7 } from '@/lib/uuid'

import { DATE_MIN } from './entryValues'
import {
  pressureBody,
  pressureDefaults,
  pressureSchema,
  type PressureValues,
} from './pressureValues'

/** Куда вернуться: на вкладку давления, если оно в списке, иначе — к замерам. */
function useBack() {
  const metrics = useMetrics()
  const pressure = metrics.data?.metrics.find(
    (metric) => metric.preset === 'blood_pressure' && !metric.archived,
  )
  return pressure
    ? ({ to: '/measurements/$metric', params: { metric: pressure.id } } as const)
    : ({ to: '/measurements' } as const)
}

function PressureForm({ item }: { item?: PressureReading }) {
  const { t } = useTranslation()
  const user = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const back = useBack()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(item?.id ?? uuidv7())
  const form = useForm<PressureValues>({
    resolver: zodResolver(pressureSchema),
    defaultValues: pressureDefaults(item, user.timezone),
  })
  const { errors, isSubmitting } = form.formState
  const unit = t('unitNames.mmhg')

  async function submit(values: PressureValues) {
    setFailure(undefined)
    const body = pressureBody(values, user.timezone)
    if (!body) {
      form.setError('time', { message: 'validation.time' })
      return
    }
    const result = await savePressure(id.current, body)
    await queryClient.invalidateQueries({ queryKey: PRESSURE_KEY })
    if (result.failure) return setFailure(result.failure)
    await navigate(back)
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">
        {t(item ? 'pressure.editTitle' : 'pressure.newTitle')}
      </h1>
      <FormError failure={failure} />
      <div className="grid grid-cols-[1fr_8rem] gap-3">
        <Controller
          name="date"
          control={form.control}
          render={({ field }) => (
            <DateField
              label={t('pressure.date')}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              min={DATE_MIN}
              max={today()}
              error={errors.date?.message}
            />
          )}
        />
        <TextField
          label={t('pressure.time')}
          type="time"
          error={errors.time?.message}
          {...form.register('time')}
        />
      </div>
      <TextField
        label={t('pressure.systolic')}
        inputMode="numeric"
        autoComplete="off"
        suffix={unit}
        hint={t('howToMeasure.blood_pressure')}
        error={errors.systolic?.message}
        {...form.register('systolic')}
      />
      <TextField
        label={t('pressure.diastolic')}
        inputMode="numeric"
        autoComplete="off"
        suffix={unit}
        error={errors.diastolic?.message}
        {...form.register('diastolic')}
      />
      <TextField
        label={t('pressure.pulse')}
        inputMode="numeric"
        autoComplete="off"
        suffix={t('pressure.pulseUnit')}
        error={errors.pulse?.message}
        {...form.register('pulse')}
      />
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {t('common.save')}
      </Button>
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link {...back}>{t('pressure.cancel')}</Link>
      </Button>
    </form>
  )
}

/** Новое показание давления. */
export function PressureNewPage() {
  return <PressureForm />
}

/** Правка показания: дата, время и все три числа. */
export function PressureEditPage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: '/app/measurements/pressure/$id' })
  const readings = usePressureReadings()
  const back = useBack()
  if (readings.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>
  const item = readings.data?.find((reading) => reading.id === id)
  if (!item) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('pressure.title')}</h1>
        <p className="text-muted-foreground">{t('pressure.notFound')}</p>
        <Button asChild variant="ghost" className="h-11 justify-self-start">
          <Link {...back}>{t('pressure.back')}</Link>
        </Button>
      </div>
    )
  }
  return <PressureForm item={item} />
}
