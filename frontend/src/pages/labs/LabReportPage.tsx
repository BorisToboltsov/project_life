import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deleteLabReport, LAB_REPORTS_KEY, useLabAnalytes, useLabReports } from '@/api/labs'
import { FormError } from '@/components/form/fields'
import { PendingMark } from '@/components/PendingMark'
import { Button } from '@/components/ui/button'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { type LabGroup, type LabReport, type LabValue, outOfRange } from '@/lib/labs'
import { useOfflineState } from '@/offline/store'

import { FilesPanel } from './FilesPanel'
import { ReportMissing } from './LabReportFormPage'
import { useValueName, useValueUnit } from './labText'
import { VALUE_ROW, ValueLine } from './LabValueLine'

/** Действия под бланком: правка шапки и удаление с вопросом. */
function ReportActions({ report }: { report: LabReport }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteLabReport(report)
    await queryClient.invalidateQueries({ queryKey: LAB_REPORTS_KEY })
    if (result.failure) return setFailure(result.failure)
    await navigate({ to: '/labs' })
  }

  return (
    <div className="grid gap-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t('labs.deleteReportConfirm')}</span>
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            {t('labs.deleteYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            {t('labs.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" className="h-11">
            <Link to="/labs/$id/edit" params={{ id: report.id }}>
              <Pencil aria-hidden="true" />
              {t('labs.edit')}
            </Link>
          </Button>
          <Button variant="ghost" className="ml-auto h-11" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden="true" />
            {t('labs.deleteReport')}
          </Button>
        </div>
      )}
      <FormError failure={failure} />
    </div>
  )
}

/**
 * Бланк анализа: шапка, значения по группам справочника — свои показатели последними — и
 * пунктирная строка «+ Показатель». Значение открывается на правку касанием.
 */
export function LabReportPage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: '/app/labs/$id' })
  const reports = useLabReports()
  const analytes = useLabAnalytes()
  const name = useValueName()
  const unit = useValueUnit()
  const { pending } = useOfflineState()

  if (reports.isPending || analytes.isPending)
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  const report = reports.data?.find((item) => item.id === id)
  if (!report) return <ReportMissing />
  const own = analytes.data?.analytes ?? []
  const catalog = analytes.data?.catalog ?? []
  const order = new Map(catalog.map((item, index) => [item.code as string, index]))
  const groupOf = new Map(catalog.map((item) => [item.code as string, item.group]))
  const sorted = [...report.values].sort(
    (a, b) => (order.get(a.preset ?? '') ?? Infinity) - (order.get(b.preset ?? '') ?? Infinity),
  )
  // Группы в порядке справочника; свои показатели — отдельной группой в конце.
  const groups = new Map<LabGroup | 'own', LabValue[]>()
  for (const value of sorted) {
    const group = (value.preset && groupOf.get(value.preset)) || 'own'
    groups.set(group, [...(groups.get(group) ?? []), value])
  }
  const marked = outOfRange(report)

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {isoToDisplay(report.local_date)}
          {pending.has(report.id) && <PendingMark />}
        </h1>
        <p className="text-muted-foreground">
          {report.lab ?? t('labs.noLab')} · {t('labs.valuesCount', { count: report.values.length })}
          {marked > 0 && (
            <span className="text-warning-foreground">
              {' · '}
              {t('labs.outOfRange', { count: marked })}
            </span>
          )}
        </p>
        {report.note && <p className="text-sm">{report.note}</p>}
      </div>
      {report.values.length === 0 && (
        <p className="text-muted-foreground">{t('labs.emptyReport')}</p>
      )}
      {[...groups].map(([group, values]) => (
        <section key={group} className="grid gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {group === 'own' ? t('labs.own') : t(`labGroups.${group}`)}
          </h2>
          <ul className="grid gap-2">
            {values.map((value) => (
              <li key={value.id}>
                <Link
                  to="/labs/$id/values/$valueId"
                  params={{ id: report.id, valueId: value.id }}
                  className={VALUE_ROW}
                >
                  <ValueLine
                    value={value}
                    name={name(value, own)}
                    unit={unit(value, own)}
                    pending={pending.has(value.id) ? <PendingMark /> : undefined}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Link
        to="/labs/$id/add"
        params={{ id: report.id }}
        className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/50 p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <Plus aria-hidden="true" className="size-5" />
        {t('labs.addValue')}
      </Link>
      <FilesPanel reportId={report.id} />
      <ReportActions report={report} />
      <Button asChild variant="ghost" className="h-11 justify-self-start">
        <Link to="/labs">{t('labs.toReports')}</Link>
      </Button>
    </div>
  )
}
