import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  type Measurement,
  MEASUREMENTS_KEY,
  type Metric,
  saveMeasurement,
  useMeasurementHistory,
  useMetrics,
} from '@/api/measurements'
import { useUser } from '@/auth/useSession'
import { DateField } from '@/components/form/DateField'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { parseDecimal } from '@/lib/numbers'
import { measuredIn, type UnitSystem } from '@/lib/units'

import { DATE_MIN, editSchema, type EditValues, inputUnit, measuredAt } from './entryValues'
import { useMetricName } from './metricName'

function EditForm({
  item,
  metric,
  system,
}: {
  item: Measurement
  metric: Metric
  system: UnitSystem
}) {
  const { t } = useTranslation()
  const name = useMetricName()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  const unit = inputUnit(metric, system)
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema(metric, system)),
    defaultValues: { date: item.local_date, value: String(measuredIn(item, unit)) },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: EditValues) {
    setFailure(undefined)
    const result = await saveMeasurement(item.id, {
      metric_id: metric.id,
      value: parseDecimal(values.value) ?? 0,
      unit,
      // Дату не меняли — момент измерения остаётся прежним.
      measured_at: values.date === item.local_date ? item.measured_at : measuredAt(values.date),
      local_date: values.date,
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: MEASUREMENTS_KEY })
    await navigate({ to: '/measurements/$metric', params: { metric: metric.id } })
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">
        {t('measurements.editTitle')}: {name(metric)}
      </h1>
      <FormError failure={failure} />
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
      <TextField
        label={t('measurements.value')}
        inputMode="decimal"
        autoComplete="off"
        suffix={t(`unitNames.${unit}`)}
        error={errors.value?.message}
        {...form.register('value')}
      />
      <div className="flex gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
        <Button asChild variant="ghost" className="h-11">
          <Link to="/measurements/$metric" params={{ metric: metric.id }}>
            {t('measurements.cancel')}
          </Link>
        </Button>
      </div>
    </form>
  )
}

const route = getRouteApi('/app/measurements/$metric/$id')

export function MeasurementEditPage() {
  const { t } = useTranslation()
  const { metric: metricId, id } = route.useParams()
  const user = useUser()
  const metrics = useMetrics()
  const history = useMeasurementHistory(metricId)
  const metric = metrics.data?.metrics.find((candidate) => candidate.id === metricId)
  const item = history.data?.find((candidate) => candidate.id === id)

  if (metrics.isPending || history.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  if (!metric || !item) {
    return (
      <div className="grid gap-4">
        <p>{t('measurements.notFound')}</p>
        <Button asChild variant="outline" className="h-11 justify-self-start">
          <Link to="/measurements/$metric" params={{ metric: metricId }}>
            {t('measurements.back')}
          </Link>
        </Button>
      </div>
    )
  }
  return <EditForm item={item} metric={metric} system={user.unit_system} />
}
