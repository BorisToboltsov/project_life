import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  deleteLabValue,
  LAB_REPORTS_KEY,
  saveLabValue,
  useLabAnalytes,
  useLabReports,
} from '@/api/labs'
import { ChoiceChip } from '@/components/form/ChoiceChip'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { keyOf, type LabReport, type LabValue, previousEntry } from '@/lib/labs'
import { parseDecimal } from '@/lib/numbers'
import { factorOf, type LabUnit } from '@/lib/labs'
import { uuidv7 } from '@/lib/uuid'

import { ReportMissing } from './LabReportFormPage'
import { type Analyte, analyteOf, useAnalyteName } from './labText'

import { valueBody, type ValueFields, valueSchema } from './labValues'

const text = (value: number | null | undefined) => (value == null ? '' : String(value))

function ValueForm({
  report,
  reports,
  analyte,
  item,
}: {
  report: LabReport
  reports: LabReport[]
  analyte: Analyte
  item?: LabValue
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const name = useAnalyteName()(analyte)
  const [failure, setFailure] = useState<ErrorKey>()
  const [confirming, setConfirming] = useState(false)
  // Ключ живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(item?.id ?? uuidv7())
  const preset = analyte.kind === 'preset' ? analyte.info : undefined
  const key = preset ? preset.code : analyte.kind === 'own' ? analyte.analyte.id : ''
  // Новое значение берёт единицу и референс прошлого — сначала из той же лаборатории.
  const previous = item ? undefined : previousEntry(reports, key, report)
  const source = item ?? previous?.value
  const form = useForm<ValueFields>({
    resolver: zodResolver(valueSchema(preset)),
    defaultValues: {
      value: text(item?.original_value),
      unit: source?.original_unit ?? preset?.unit ?? '',
      low: text(source?.ref_low),
      high: text(source?.ref_high),
    },
  })
  const { errors, isSubmitting } = form.formState
  const unit = useWatch({ control: form.control, name: 'unit' })
  const unitName = preset
    ? unit
      ? t(`labUnits.${unit as NonNullable<LabValue['original_unit']>}`)
      : ''
    : analyte.kind === 'own'
      ? analyte.analyte.unit
      : ''
  const back = { to: '/labs/$id', params: { id: report.id } } as const

  // При смене единицы сохраняем смысл числа и обеих границ, включая подставленные.
  function changeUnit(next: LabUnit) {
    if (!preset || next === unit) return
    const ratio = factorOf(preset, unit as LabUnit) / factorOf(preset, next)
    for (const field of ['value', 'low', 'high'] as const) {
      const value = parseDecimal(form.getValues(field))
      if (value !== null) form.setValue(field, String(Math.round(value * ratio * 10_000) / 10_000))
    }
    form.setValue('unit', next, { shouldValidate: true, shouldDirty: true })
  }

  async function submit(values: ValueFields) {
    setFailure(undefined)
    const body = valueBody(values, preset ? { preset: preset.code } : { analyteId: key })
    const result = await saveLabValue(report, id.current, body)
    await queryClient.invalidateQueries({ queryKey: LAB_REPORTS_KEY })
    if (result.failure) return setFailure(result.failure)
    await navigate(back)
  }

  async function remove() {
    if (!item) return
    const result = await deleteLabValue(report, item)
    await queryClient.invalidateQueries({ queryKey: LAB_REPORTS_KEY })
    if (result.failure) return setFailure(result.failure)
    await navigate(back)
  }

  const sourceHint =
    previous &&
    (previous.report.lab
      ? t('labs.referenceFrom', {
          lab: previous.report.lab,
          date: isoToDisplay(previous.report.local_date),
        })
      : t('labs.referenceFromDate', { date: isoToDisplay(previous.report.local_date) }))

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{name}</h1>
        <p className="text-sm text-muted-foreground">
          {isoToDisplay(report.local_date)} · {report.lab ?? t('labs.noLab')}
        </p>
      </div>
      <FormError failure={failure} />
      <TextField
        label={t('labs.value')}
        inputMode="decimal"
        autoComplete="off"
        suffix={unitName}
        error={errors.value?.message}
        {...form.register('value')}
      />
      {preset && preset.units.length > 1 && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{t('labs.unit')}</legend>
          <div className="flex flex-wrap gap-2">
            {preset.units.map((option) => (
              <ChoiceChip
                key={option.unit}
                value={option.unit}
                checked={unit === option.unit}
                name="unit"
                onChange={() => changeUnit(option.unit)}
              >
                {t(`labUnits.${option.unit}`)}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t('labs.reference')}</legend>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('labs.referenceLow')}
            inputMode="decimal"
            autoComplete="off"
            error={errors.low?.message}
            {...form.register('low')}
          />
          <TextField
            label={t('labs.referenceHigh')}
            inputMode="decimal"
            autoComplete="off"
            error={errors.high?.message}
            {...form.register('high')}
          />
        </div>
        <p className="text-sm text-muted-foreground">{sourceHint ?? t('labs.referenceHint')}</p>
      </fieldset>
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {item ? t('common.save') : t('labs.add')}
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" className="h-11">
          <Link {...back}>{t('labs.cancel')}</Link>
        </Button>
        {item &&
          (confirming ? (
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-sm">{t('labs.deleteValueConfirm')}</span>
              <Button variant="destructive" size="sm" onClick={() => void remove()}>
                {t('labs.deleteYes')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                {t('labs.cancel')}
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto h-11"
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
              {t('labs.deleteValue')}
            </Button>
          ))}
      </div>
    </form>
  )
}

function AnalyteMissing({ reportId }: { reportId: string }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('labs.pickTitle')}</h1>
      <p className="text-muted-foreground">{t('labs.analyteNotFound')}</p>
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/labs/$id" params={{ id: reportId }}>
          {t('labs.cancel')}
        </Link>
      </Button>
    </div>
  )
}

/** Новое значение показателя в бланке. */
export function LabValueNewPage() {
  const { t } = useTranslation()
  const { id, key } = useParams({ from: '/app/labs/$id/add/$key' })
  const reports = useLabReports()
  const analytes = useLabAnalytes()
  if (reports.isPending || analytes.isPending)
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  const report = reports.data?.find((item) => item.id === id)
  if (!report) return <ReportMissing />
  const analyte = analyteOf(key, analytes.data?.catalog ?? [], analytes.data?.analytes ?? [])
  if (!analyte) return <AnalyteMissing reportId={report.id} />
  // Показатель уже в бланке — открываем его значение на правку, а не второе такое же.
  const existing = report.values.find((value) => keyOf(value) === key)
  return (
    <ValueForm
      key={existing?.id ?? key}
      report={report}
      reports={reports.data ?? []}
      analyte={analyte}
      item={existing}
    />
  )
}

/** Правка значения: число, единица и референс; показатель не меняется (инвариант I22). */
export function LabValueEditPage() {
  const { t } = useTranslation()
  const { id, valueId } = useParams({ from: '/app/labs/$id/values/$valueId' })
  const reports = useLabReports()
  const analytes = useLabAnalytes()
  if (reports.isPending || analytes.isPending)
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  const report = reports.data?.find((item) => item.id === id)
  if (!report) return <ReportMissing />
  const item = report.values.find((value) => value.id === valueId)
  const analyte =
    item && analyteOf(keyOf(item), analytes.data?.catalog ?? [], analytes.data?.analytes ?? [])
  if (!item || !analyte) return <AnalyteMissing reportId={report.id} />
  return <ValueForm report={report} reports={reports.data ?? []} analyte={analyte} item={item} />
}
