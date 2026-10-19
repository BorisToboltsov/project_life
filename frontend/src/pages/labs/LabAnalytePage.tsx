import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  deleteLabAnalyte,
  LAB_ANALYTES_KEY,
  saveLabAnalyte,
  useLabAnalytes,
  useLabReports,
} from '@/api/labs'
import { Chart } from '@/components/chart/Chart'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import {
  historyOf,
  LAB_DIGITS,
  labCanonical,
  type LabUnit,
  markOf,
  type OwnAnalyte,
} from '@/lib/labs'
import { formatNumber } from '@/lib/numbers'

import { type Analyte, analyteOf, useAnalyteName, useLabNumber, useValueUnit } from './labText'
import { VALUE_ROW, ValueLine } from './LabValueLine'
import { ownAnalyteSchema, type OwnAnalyteValues } from './labValues'

/** Свой показатель: переименовать, убрать из списка или вернуть. Единица не меняется. */
function OwnActions({ analyte }: { analyte: OwnAnalyte }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'idle' | 'renaming' | 'confirming'>('idle')
  const [failure, setFailure] = useState<ErrorKey>()
  const form = useForm<OwnAnalyteValues>({
    resolver: zodResolver(ownAnalyteSchema),
    defaultValues: { name: analyte.name, unit: analyte.unit },
  })
  const { errors, isSubmitting } = form.formState

  async function settle(result: { failure?: ErrorKey }) {
    await queryClient.invalidateQueries({ queryKey: LAB_ANALYTES_KEY })
    setFailure(result.failure)
    if (!result.failure) setMode('idle')
  }
  const rename = async (values: OwnAnalyteValues) =>
    settle(await saveLabAnalyte(analyte.id, { name: values.name, unit: analyte.unit }))
  const restore = async () =>
    settle(await saveLabAnalyte(analyte.id, { name: analyte.name, unit: analyte.unit }))
  const remove = async () => settle(await deleteLabAnalyte(analyte))

  if (mode === 'renaming') {
    return (
      <form
        onSubmit={(event) => void form.handleSubmit(rename)(event)}
        noValidate
        className="grid gap-3"
      >
        <FormError failure={failure} />
        <TextField
          label={t('labs.ownName')}
          autoComplete="off"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <div className="flex gap-3">
          <Button type="submit" className="h-11" disabled={isSubmitting}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={() => setMode('idle')}>
            {t('labs.cancel')}
          </Button>
        </div>
      </form>
    )
  }
  return (
    <div className="grid gap-2">
      {analyte.archived && <p className="text-sm text-muted-foreground">{t('labs.archived')}</p>}
      {mode === 'confirming' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t('labs.removeConfirm', { name: analyte.name })}</span>
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            {t('labs.removeYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode('idle')}>
            {t('labs.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="h-11" onClick={() => setMode('renaming')}>
            <Pencil aria-hidden="true" />
            {t('labs.rename')}
          </Button>
          {analyte.archived ? (
            <Button variant="outline" className="ml-auto h-11" onClick={() => void restore()}>
              {t('labs.restore')}
            </Button>
          ) : (
            <Button variant="ghost" className="ml-auto h-11" onClick={() => setMode('confirming')}>
              <Trash2 aria-hidden="true" />
              {t('labs.remove')}
            </Button>
          )}
        </div>
      )}
      <FormError failure={failure} />
    </div>
  )
}

/**
 * Показатель во времени (ADR 0022): график по всем бланкам — у штатного в канонической
 * единице — с полосой референса последнего бланка и история значений, как на бланках.
 */
function AnalyteHistory({ analyte, analyteKey }: { analyte: Analyte; analyteKey: string }) {
  const { t, i18n } = useTranslation()
  const reports = useLabReports()
  const analytes = useLabAnalytes()
  const own = useMemo(() => analytes.data?.analytes ?? [], [analytes.data])
  const name = useAnalyteName()(analyte)
  const unit = useValueUnit()
  const number = useLabNumber()
  const entries = useMemo(
    () => historyOf(reports.data ?? [], analyteKey),
    [reports.data, analyteKey],
  )
  const preset = analyte.kind === 'preset' ? analyte.info : undefined
  const chartUnit = preset
    ? t(`labUnits.${preset.unit}`)
    : analyte.kind === 'own'
      ? analyte.analyte.unit
      : ''
  // Референс в единицу графика: у штатного — по множителю единицы бланка.
  const toChart = useCallback(
    (bound: number | null, original: LabUnit | null) =>
      bound === null || !preset || !original ? bound : labCanonical(preset, bound, original),
    [preset],
  )
  const values = useMemo(
    () => ({
      name: t('labs.chartValues'),
      points: [...entries].reverse().map(({ report, value }) => ({
        date: report.local_date,
        value: value.value,
        marked: markOf(value) !== null,
      })),
    }),
    [entries, t],
  )
  const [latest] = entries
  const band = useMemo(
    () =>
      latest && (latest.value.ref_low !== null || latest.value.ref_high !== null)
        ? {
            low: toChart(latest.value.ref_low, latest.value.original_unit),
            high: toChart(latest.value.ref_high, latest.value.original_unit),
          }
        : undefined,
    [latest, toChart],
  )
  const formatValue = useCallback(
    (value: number) => `${formatNumber(value, i18n.language, LAB_DIGITS)} ${chartUnit}`,
    [chartUnit, i18n.language],
  )
  const converted = preset && entries.some(({ value }) => value.original_unit !== preset.unit)

  return (
    <>
      {latest && (
        <p className="text-muted-foreground">
          {t('labs.latest', {
            value: `${number(latest.value.original_value)} ${unit(latest.value, own)}`,
            date: isoToDisplay(latest.report.local_date),
          })}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('labs.chart')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {entries.length >= 2 ? (
            <>
              <Chart
                values={values}
                band={band}
                formatValue={formatValue}
                label={`${t('labs.chart')}: ${name}`}
              />
              {band && <p className="text-xs text-muted-foreground">{t('labs.chartBand')}</p>}
              {converted && (
                <p className="text-xs text-muted-foreground">
                  {t('labs.chartUnit', { unit: chartUnit })}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('labs.chartNeedsMore')}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('labs.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul aria-label={t('labs.history')} className="grid gap-2">
            {entries.map(({ report, value }) => (
              <li key={value.id}>
                <Link to="/labs/$id" params={{ id: report.id }} className={VALUE_ROW}>
                  <ValueLine
                    value={value}
                    name={isoToDisplay(report.local_date)}
                    unit={unit(value, own)}
                    detail={report.lab ?? t('labs.noLab')}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}

export function LabAnalytePage() {
  const { t } = useTranslation()
  const { key } = useParams({ from: '/app/labs/analytes/$key' })
  const analytes = useLabAnalytes()
  const name = useAnalyteName()
  if (analytes.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>
  const analyte = analyteOf(key, analytes.data?.catalog ?? [], analytes.data?.analytes ?? [])
  if (!analyte) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('labs.analytes')}</h1>
        <p className="text-muted-foreground">{t('labs.analyteNotFound')}</p>
        <Button asChild variant="ghost" className="h-11 justify-self-start">
          <Link to="/labs/analytes">{t('labs.analytes')}</Link>
        </Button>
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{name(analyte)}</h1>
        {analyte.kind === 'own' && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {t('labs.ownMark')}
          </span>
        )}
      </div>
      <AnalyteHistory analyte={analyte} analyteKey={key} />
      {analyte.kind === 'own' && <OwnActions analyte={analyte.analyte} />}
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/labs/analytes">{t('labs.analytes')}</Link>
      </Button>
    </div>
  )
}
