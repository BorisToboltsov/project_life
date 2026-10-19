import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  listed,
  MEASUREMENTS_KEY,
  type Metric,
  saveMeasurement,
  singleValued,
  useMetrics,
} from '@/api/measurements'
import { DIARY_KEY } from '@/api/nutrition'
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

import { AddMetricLink } from './AddMetricLink'
import { DATE_MIN, entrySchema, type EntryValues, inputUnit, measuredAt } from './entryValues'
import { useMetricName } from './metricName'

function EntryForm({ metrics, system }: { metrics: Metric[]; system: UnitSystem }) {
  const { t } = useTranslation()
  const name = useMetricName()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const [nothingEntered, setNothingEntered] = useState(false)
  // Ключи записей живут, пока открыта форма: повторная отправка после сбоя не создаст дубли.
  const ids = useRef(new Map<string, string>())
  const form = useForm<EntryValues>({
    resolver: zodResolver(entrySchema(metrics, system)),
    defaultValues: {
      date: today(),
      values: Object.fromEntries(metrics.map((metric) => [metric.id, ''])),
    },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: EntryValues) {
    setFailure(undefined)
    const entered = metrics.flatMap((metric) => {
      const value = parseDecimal(values.values[metric.id])
      return value === null ? [] : [{ metric, value }]
    })
    setNothingEntered(entered.length === 0)
    if (entered.length === 0) return

    const results = await Promise.all(
      entered.map(({ metric, value }) => {
        const id = ids.current.get(metric.id) ?? uuidv7()
        ids.current.set(metric.id, id)
        return saveMeasurement(id, {
          metric_id: metric.id,
          value,
          unit: inputUnit(metric, system),
          measured_at: measuredAt(values.date),
          local_date: values.date,
        })
      }),
    )
    await queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY })
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
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
      {metrics.map((metric) => (
        <Card key={metric.id}>
          <CardContent className="flex items-start gap-4">
            <div className="w-24 shrink-0 sm:w-28">
              <MeasureIllustration preset={metric.preset} />
            </div>
            <div className="min-w-0 flex-1">
              <TextField
                label={name(metric)}
                inputMode="decimal"
                autoComplete="off"
                suffix={t(`unitNames.${inputUnit(metric, system)}`)}
                hint={metric.preset ? t(`howToMeasure.${metric.preset}`) : undefined}
                error={errors.values?.[metric.id]?.message}
                {...form.register(`values.${metric.id}`)}
              />
            </div>
          </CardContent>
        </Card>
      ))}
      <AddMetricLink label={t('metric.addLong')} />
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
  const metrics = useMetrics()

  if (metrics.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const inList = singleValued(listed(metrics.data?.metrics))
  if (inList.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('measurements.newTitle')}</h1>
        <p className="text-muted-foreground">{t('metric.listEmpty')}</p>
        <AddMetricLink label={t('metric.addLong')} />
      </div>
    )
  }
  return <EntryForm metrics={inList} system={user.unit_system} />
}
