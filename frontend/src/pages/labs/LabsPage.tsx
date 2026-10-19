import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useLabAnalytes, useLabReports } from '@/api/labs'
import { PendingMark } from '@/components/PendingMark'
import { Button } from '@/components/ui/button'
import { isoToDisplay } from '@/lib/dates'
import { latestByAnalyte, outOfRange } from '@/lib/labs'
import { useOfflineState } from '@/offline/store'

import { analyteOf, useAnalyteName, useValueUnit } from './labText'
import { VALUE_ROW, ValueLine } from './LabValueLine'

/** «Бланки» и «Показатели» — два взгляда на одни анализы. */
function LabsTabs({ current }: { current: 'reports' | 'analytes' }) {
  const { t } = useTranslation()
  const tab = (active: boolean) =>
    active
      ? 'flex-1 rounded-md bg-background px-3 py-2 text-center text-sm font-medium shadow-sm'
      : 'flex-1 rounded-md px-3 py-2 text-center text-sm text-muted-foreground'
  return (
    <nav aria-label={t('labs.title')} className="flex gap-1 rounded-lg bg-muted p-1">
      <Link
        to="/labs"
        aria-current={current === 'reports' ? 'page' : undefined}
        className={tab(current === 'reports')}
      >
        {t('labs.reports')}
      </Link>
      <Link
        to="/labs/analytes"
        aria-current={current === 'analytes' ? 'page' : undefined}
        className={tab(current === 'analytes')}
      >
        {t('labs.analytes')}
      </Link>
    </nav>
  )
}

function Header() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{t('labs.title')}</h1>
      <Button asChild className="h-11">
        <Link to="/labs/new">{t('labs.newReport')}</Link>
      </Button>
    </div>
  )
}

/** Бланки анализов, новые первыми: дата забора, лаборатория, сколько вне референса. */
export function LabsPage() {
  const { t } = useTranslation()
  const reports = useLabReports()
  const { pending } = useOfflineState()

  return (
    <div className="grid gap-4">
      <Header />
      <LabsTabs current="reports" />
      {reports.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {reports.data?.length === 0 && (
        <p className="text-muted-foreground">{t('labs.emptyReports')}</p>
      )}
      <ul aria-label={t('labs.reports')} className="grid gap-2">
        {reports.data?.map((report) => {
          const marked = outOfRange(report)
          return (
            <li key={report.id}>
              <Link
                to="/labs/$id"
                params={{ id: report.id }}
                className="flex min-h-14 items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <span className="grid flex-1 gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    {isoToDisplay(report.local_date)} · {report.lab ?? t('labs.noLab')}
                    {pending.has(report.id) && <PendingMark />}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t('labs.valuesCount', { count: report.values.length })}
                    {marked > 0 && (
                      <span className="text-warning-foreground">
                        {' · '}
                        {t('labs.outOfRange', { count: marked })}
                      </span>
                    )}
                  </span>
                </span>
                <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Показатели, у которых есть значения: последнее значение, дата и отметка. */
export function LabAnalytesPage() {
  const { t } = useTranslation()
  const reports = useLabReports()
  const analytes = useLabAnalytes()
  const name = useAnalyteName()
  const unit = useValueUnit()
  const own = analytes.data?.analytes ?? []
  const catalog = analytes.data?.catalog ?? []
  const latest = latestByAnalyte(reports.data ?? [])
  // Штатные — в порядке справочника, свои — следом, по алфавиту.
  const keys = [
    ...catalog.map((item) => item.code as string).filter((key) => latest.has(key)),
    ...own
      .filter((item) => latest.has(item.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => item.id),
  ]

  return (
    <div className="grid gap-4">
      <Header />
      <LabsTabs current="analytes" />
      {(reports.isPending || analytes.isPending) && (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      )}
      {reports.data && keys.length === 0 && (
        <p className="text-muted-foreground">{t('labs.emptyAnalytes')}</p>
      )}
      <ul aria-label={t('labs.analytes')} className="grid gap-2">
        {keys.map((key) => {
          const entry = latest.get(key)!
          return (
            <li key={key}>
              <Link to="/labs/analytes/$key" params={{ key }} className={VALUE_ROW}>
                <ValueLine
                  value={entry.value}
                  name={name(analyteOf(key, catalog, own))}
                  unit={unit(entry.value, own)}
                  detail={isoToDisplay(entry.report.local_date)}
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
