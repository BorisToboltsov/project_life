import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  MEASUREMENTS_KEY,
  type Metric,
  type MetricType,
  saveMeasurement,
  useMetricTypes,
} from '@/api/measurements'
import { useUser } from '@/auth/useSession'
import { DateField } from '@/components/form/DateField'
import { FormError, TextField } from '@/components/form/fields'
import { MeasureIllustration } from '@/components/illustrations/MeasureIllustration'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { parseDecimal } from '@/lib/numbers'
import type { UnitSystem } from '@/lib/units'
import { uuidv7 } from '@/lib/uuid'

import { DATE_MIN, entrySchema, type EntryValues, inputUnit, measuredAt } from './entryValues'

function EntryForm({ types, system }: { types: MetricType[]; system: UnitSystem }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const [nothingEntered, setNothingEntered] = useState(false)
  // Ключи записей живут, пока открыта форма: повторная отправка после сбоя не создаст дубли.
  const ids = useRef(new Map<Metric, string>())
  const form = useForm<EntryValues>({
    resolver: zodResolver(entrySchema(types, system)),
    defaultValues: { date: today(), weight: '', neck: '', waist: '', hips: '' },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: EntryValues) {
    setFailure(undefined)
    const entered = types.flatMap((type) => {
      const value = parseDecimal(values[type.code])
      return value === null ? [] : [{ type, value }]
    })
    setNothingEntered(entered.length === 0)
    if (entered.length === 0) return

    const results = await Promise.all(
      entered.map(({ type, value }) => {
        const id = ids.current.get(type.code) ?? uuidv7()
        ids.current.set(type.code, id)
        return saveMeasurement(id, {
          metric: type.code,
          value,
          unit: inputUnit(type, system),
          measured_at: measuredAt(values.date),
          local_date: values.date,
        })
      }),
    )
    await queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY })
    const failed = results.find((result) => result.failure)
    if (failed?.failure) setFailure(failed.failure)
    else await navigate({ to: '/' })
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">{t('measurements.newTitle')}</h1>
      <Controller
        name="date"
        control={form.control}
        render={({ field }) => (
          <DateField
            label={t('measurements.date')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            min={DATE_MIN}
            max={today()}
            error={errors.date?.message}
          />
        )}
      />
      {types.map((type) => (
        <Card key={type.code}>
          <CardContent className="flex items-start gap-4">
            <div className="w-24 shrink-0 sm:w-28">
              <MeasureIllustration metric={type.code} />
            </div>
            <div className="min-w-0 flex-1">
              <TextField
                label={t(`metrics.${type.code}`)}
                inputMode="decimal"
                autoComplete="off"
                suffix={t(`unitNames.${inputUnit(type, system)}`)}
                hint={t(`howToMeasure.${type.code}`)}
                error={errors[type.code]?.message}
                {...form.register(type.code)}
              />
            </div>
          </CardContent>
        </Card>
      ))}
      {nothingEntered && (
        <Alert variant="destructive">
          <AlertDescription>{t('validation.measurementRequired')}</AlertDescription>
        </Alert>
      )}
      <FormError failure={failure} />
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {t('common.save')}
      </Button>
    </form>
  )
}

export function MeasurementEntryPage() {
  const { t } = useTranslation()
  const user = useUser()
  const types = useMetricTypes()

  if (!types.data?.length) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  return <EntryForm types={types.data} system={user.unit_system} />
}
