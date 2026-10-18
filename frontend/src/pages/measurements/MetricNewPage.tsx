import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  addPresetMetric,
  type Metric,
  type MetricPreset,
  METRICS_KEY,
  saveMetric,
  useMetrics,
} from '@/api/measurements'
import { useUser } from '@/auth/useSession'
import { ChoiceChip } from '@/components/form/ChoiceChip'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'
import { useOfflineState } from '@/offline/store'

import { inputUnit, metricSchema, type MetricValues, QUANTITIES } from './entryValues'
import { useMetricName } from './metricName'

/** Свой вид замера: название и что измеряем. Он встаёт в конец списка. */
function OwnMetricForm() {
  const { t } = useTranslation()
  const user = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ вида живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(uuidv7())
  const form = useForm<MetricValues>({
    resolver: zodResolver(metricSchema),
    defaultValues: { name: '', quantity: 'length' },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: MetricValues) {
    setFailure(undefined)
    const result = await saveMetric(id.current, values)
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: METRICS_KEY })
    // Новый вид сразу ждёт первое значение.
    await navigate({ to: '/measurements/new' })
  }

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={(event) => void form.handleSubmit(submit)(event)}
          noValidate
          className="grid gap-4"
        >
          <FormError failure={failure} />
          <TextField
            label={t('metric.name')}
            autoComplete="off"
            hint={t('metric.nameHint')}
            error={errors.name?.message}
            {...form.register('name')}
          />
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t('metric.quantity')}</legend>
            <div className="flex flex-wrap gap-2">
              {QUANTITIES.map((quantity) => (
                <ChoiceChip key={quantity} value={quantity} {...form.register('quantity')}>
                  {t(`quantityNames.${quantity}`)},{' '}
                  {t(`unitNames.${inputUnit({ quantity }, user.unit_system)}`)}
                </ChoiceChip>
              ))}
            </div>
          </fieldset>
          <Button type="submit" className="h-11 justify-self-start" disabled={isSubmitting}>
            {t('metric.create')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * Экран «+»: рекомендуемые виды замеров добавляются одним касанием, убранные свои
 * возвращаются, ниже — форма своего вида.
 */
export function MetricNewPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const metrics = useMetrics()
  const name = useMetricName()
  const { online } = useOfflineState()
  const [added, setAdded] = useState<string>()
  const [failure, setFailure] = useState<ErrorKey>()

  async function settle(result: { failure?: ErrorKey }, label: string) {
    setFailure(result.failure)
    setAdded(result.failure ? undefined : label)
    await queryClient.invalidateQueries({ queryKey: METRICS_KEY })
  }

  const addPreset = async (preset: MetricPreset) =>
    settle(await addPresetMetric(preset), t(`metrics.${preset}`))
  const restore = async (metric: Metric) =>
    settle(
      await saveMetric(metric.id, { name: name(metric), quantity: metric.quantity }),
      name(metric),
    )

  // Список видов меняется только при связи (ADR 0020).
  if (!online) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('metric.newTitle')}</h1>
        <p className="text-muted-foreground">{t('metric.offline')}</p>
        <Button asChild variant="ghost" className="h-11 justify-self-start">
          <Link to="/measurements/new">{t('measurements.add')}</Link>
        </Button>
      </div>
    )
  }
  if (metrics.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const available = metrics.data?.available ?? []
  // Убранный штатный вид снова стоит среди рекомендуемых; отдельным списком — только свои.
  const removed = (metrics.data?.metrics ?? []).filter(
    (metric) => metric.archived && !metric.preset,
  )

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('metric.newTitle')}</h1>
      <FormError failure={failure} />
      {added && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('metric.added', { name: added })}
        </p>
      )}
      {available.length > 0 && (
        <Card>
          <CardContent className="grid gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t('metric.recommended')}</h2>
            <ul aria-label={t('metric.recommended')} className="flex flex-wrap gap-2">
              {available.map((preset) => (
                <li key={preset}>
                  <Button
                    variant="outline"
                    className="h-11 rounded-full"
                    aria-label={t('metric.addPreset', { name: t(`metrics.${preset}`) })}
                    onClick={() => void addPreset(preset)}
                  >
                    <Plus aria-hidden="true" />
                    {t(`metrics.${preset}`)}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {removed.length > 0 && (
        <Card>
          <CardContent className="grid gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t('metric.removed')}</h2>
            <ul aria-label={t('metric.removed')} className="grid gap-2">
              {removed.map((metric) => (
                <li
                  key={metric.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span className="font-medium">{name(metric)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t('metric.restoreNamed', { name: name(metric) })}
                    onClick={() => void restore(metric)}
                  >
                    {t('metric.restore')}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <OwnMetricForm />
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/measurements/new">{t('measurements.add')}</Link>
      </Button>
    </div>
  )
}
