import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { LAB_REPORTS_KEY, saveLabReport, useLabReports } from '@/api/labs'
import { DateField } from '@/components/form/DateField'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { knownLabs, type LabReport } from '@/lib/labs'
import { uuidv7 } from '@/lib/uuid'
import { DATE_MIN } from '@/pages/measurements/entryValues'

import { reportBody, reportSchema, type ReportValues } from './labValues'

/** Сколько своих лабораторий подсказывать под полем. */
const KNOWN_LABS = 4

function ReportForm({ item, reports }: { item?: LabReport; reports: LabReport[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(item?.id ?? uuidv7())
  const form = useForm<ReportValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      date: item?.local_date ?? today(),
      lab: item?.lab ?? '',
      note: item?.note ?? '',
    },
  })
  const { errors, isSubmitting } = form.formState
  const labs = knownLabs(reports).slice(0, KNOWN_LABS)
  const lab = useWatch({ control: form.control, name: 'lab' })

  async function submit(values: ReportValues) {
    setFailure(undefined)
    const result = await saveLabReport(id.current, reportBody(values))
    await queryClient.invalidateQueries({ queryKey: LAB_REPORTS_KEY })
    if (result.failure) return setFailure(result.failure)
    // Новый бланк сразу ждёт первый показатель.
    await navigate(
      item
        ? { to: '/labs/$id', params: { id: id.current } }
        : { to: '/labs/$id/add', params: { id: id.current } },
    )
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <h1 className="text-2xl font-semibold">{t(item ? 'labs.editReport' : 'labs.newReport')}</h1>
      <FormError failure={failure} />
      <Controller
        name="date"
        control={form.control}
        render={({ field }) => (
          <DateField
            label={t('labs.date')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            min={DATE_MIN}
            max={today()}
            error={errors.date?.message}
          />
        )}
      />
      <div className="grid gap-2">
        <TextField
          label={t('labs.lab')}
          autoComplete="off"
          hint={t('labs.labHint')}
          error={errors.lab?.message}
          {...form.register('lab')}
        />
        {labs.length > 0 && (
          <ul aria-label={t('labs.knownLabs')} className="flex flex-wrap gap-2">
            {labs.map((name) => (
              <li key={name}>
                <Button
                  type="button"
                  variant={lab.trim() === name ? 'secondary' : 'outline'}
                  className="h-11 rounded-full"
                  onClick={() => form.setValue('lab', name, { shouldValidate: true })}
                >
                  {name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <TextField
        label={t('labs.note')}
        autoComplete="off"
        hint={t('labs.noteHint')}
        error={errors.note?.message}
        {...form.register('note')}
      />
      <Button type="submit" className="h-11" disabled={isSubmitting}>
        {item ? t('common.save') : t('labs.create')}
      </Button>
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        {item ? (
          <Link to="/labs/$id" params={{ id: item.id }}>
            {t('labs.cancel')}
          </Link>
        ) : (
          <Link to="/labs">{t('labs.cancel')}</Link>
        )}
      </Button>
    </form>
  )
}

/** Новый бланк: дата забора, лаборатория, заметка. */
export function LabReportNewPage() {
  const { t } = useTranslation()
  const reports = useLabReports()
  if (reports.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>
  return <ReportForm reports={reports.data ?? []} />
}

/** Правка шапки бланка; значения бланка она не трогает. */
export function LabReportEditPage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: '/app/labs/$id/edit' })
  const reports = useLabReports()
  if (reports.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>
  const item = reports.data?.find((report) => report.id === id)
  if (!item) return <ReportMissing />
  return <ReportForm item={item} reports={reports.data ?? []} />
}

/** Бланка нет: удалён или адрес чужой. */
export function ReportMissing() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('labs.title')}</h1>
      <p className="text-muted-foreground">{t('labs.notFound')}</p>
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/labs">{t('labs.toReports')}</Link>
      </Button>
    </div>
  )
}
