import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deletePressure, PRESSURE_KEY, usePressureReadings } from '@/api/pressure'
import { useUser } from '@/auth/useSession'
import { Chart } from '@/components/chart/Chart'
import { FormError } from '@/components/form/fields'
import { PendingMark } from '@/components/PendingMark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime, today } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { aboveHomeLimit, type PressureReading, weekAverage } from '@/lib/pressure'
import { useOfflineState } from '@/offline/store'

import { usePressureText } from './pressureText'

/** Отметка «выше 135/85» (ADR 0022): порог домашнего измерения. */
export function PressureMark({
  reading,
}: {
  reading: Pick<PressureReading, 'systolic' | 'diastolic'>
}) {
  const { t } = useTranslation()
  if (!aboveHomeLimit(reading)) return null
  return (
    <span className="inline-block rounded bg-warning px-1.5 py-0.5 text-xs font-medium text-warning-foreground">
      {t('pressure.aboveLimit')}
    </span>
  )
}

function Latest({ reading }: { reading: PressureReading }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const text = usePressureText()
  const { pending } = useOfflineState()
  return (
    <div className="grid gap-1">
      <p className="text-sm text-muted-foreground">{t('pressure.latest')}</p>
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-3xl font-semibold">{text(reading)}</span>
        <span className="text-sm text-muted-foreground">{t('unitNames.mmhg')}</span>
        <PressureMark reading={reading} />
        {pending.has(reading.id) && <PendingMark />}
      </p>
      <p className="text-sm text-muted-foreground">
        {reading.pulse !== null && `${t('pressure.pulseLine', { pulse: reading.pulse })} · `}
        {formatDateTime(reading.measured_at, i18n.language, user.timezone)}
      </p>
    </div>
  )
}

function Week({ readings }: { readings: PressureReading[] }) {
  const { t } = useTranslation()
  const user = useUser()
  const text = usePressureText()
  const average = weekAverage(readings, today(user.timezone))
  return (
    <div className="grid gap-1 border-t pt-3">
      <p className="text-sm text-muted-foreground">{t('pressure.week')}</p>
      {average ? (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold">{text(average)}</span>
            <PressureMark reading={average} />
          </p>
          <p className="text-sm text-muted-foreground">
            {average.pulse !== null && `${t('pressure.pulseLine', { pulse: average.pulse })} · `}
            {t('pressure.weekCount', { count: average.count })}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('pressure.weekEmpty')}</p>
      )}
    </div>
  )
}

function HistoryRow({ reading }: { reading: PressureReading }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const text = usePressureText()
  const queryClient = useQueryClient()
  const { pending } = useOfflineState()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deletePressure(reading)
    if (result.failure) setFailure(result.failure)
    await queryClient.invalidateQueries({ queryKey: PRESSURE_KEY })
  }

  return (
    <li className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            {text(reading)}
            {reading.pulse !== null && (
              <span className="font-normal text-muted-foreground">
                · {t('pressure.pulseLine', { pulse: reading.pulse })}
              </span>
            )}
            <PressureMark reading={reading} />
            {pending.has(reading.id) && <PendingMark />}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(reading.measured_at, i18n.language, user.timezone)}
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">{t('pressure.deleteConfirm')}</span>
            <Button variant="destructive" size="sm" onClick={() => void remove()}>
              {t('pressure.deleteYes')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('pressure.cancel')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button asChild variant="ghost" size="icon" aria-label={t('pressure.edit')}>
              <Link to="/measurements/pressure/$id" params={{ id: reading.id }}>
                <Pencil aria-hidden="true" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('pressure.delete')}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <FormError failure={failure} />
    </li>
  )
}

/**
 * Вкладка давления в замерах (ADR 0022): последнее показание, среднее за неделю, график
 * верхнего и нижнего и история. Отметка «выше 135/85» вычисляется здесь же (инвариант I22).
 */
export function PressurePanel() {
  const { t } = useTranslation()
  const readings = usePressureReadings()
  const items = useMemo(() => readings.data ?? [], [readings.data])
  const unit = t('unitNames.mmhg')

  // Показания приходят новыми вперёд; графику нужен порядок по времени.
  const chronological = useMemo(() => [...items].reverse(), [items])
  const systolic = useMemo(
    () => ({
      name: t('pressure.systolic'),
      points: chronological.map((item) => ({
        date: item.local_date,
        value: item.systolic,
        marked: aboveHomeLimit(item),
      })),
    }),
    [chronological, t],
  )
  const diastolic = useMemo(
    () => ({
      name: t('pressure.diastolic'),
      points: chronological.map((item) => ({ date: item.local_date, value: item.diastolic })),
    }),
    [chronological, t],
  )
  const formatValue = useCallback((value: number) => `${Math.round(value)} ${unit}`, [unit])

  if (readings.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>
  const [latest] = items
  return (
    <>
      <Card>
        <CardContent className="grid gap-3">
          {latest ? <Latest reading={latest} /> : <p>{t('pressure.empty')}</p>}
          <Week readings={items} />
          <p className="text-xs text-muted-foreground">{t('pressure.limitHint')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('pressure.chart')}</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length >= 2 ? (
            <Chart
              values={systolic}
              second={diastolic}
              formatValue={formatValue}
              label={`${t('pressure.chart')}: ${t('pressure.title')}`}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('pressure.chartNeedsMore')}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('pressure.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('pressure.empty')}</p>
          )}
          <ul aria-label={t('pressure.history')} className="grid gap-2">
            {items.map((item) => (
              <HistoryRow key={item.id} reading={item} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}
