import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Dumbbell, GlassWater, ScanBarcode, Timer, Utensils } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDiaryDay } from '@/api/nutrition'
import { WORKOUTS_KEY } from '@/api/workouts'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { formatDateTime, isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import type { Deferred, Rejected } from '@/offline/db'
import { deferredBarcodes } from '@/offline/deferred'
import { forget } from '@/offline/queue'
import { useOfflineState } from '@/offline/store'
import { useDeferredAmount } from '@/pages/diary/deferredAmount'
import { useMealName } from '@/pages/diary/mealName'
import { useQuantityText } from '@/pages/diary/quantityText'

import { moveToNewWorkout, rejectedSets } from './rescue'

/** Отказы одной тренировки — одна строка: причина у них общая, исправлять их вместе. */
function grouped(rejected: readonly Rejected[]): Rejected[][] {
  const groups = new Map<string, Rejected[]>()
  for (const change of rejected) {
    const key = change.context.workoutId ?? `change:${change.seq}`
    groups.set(key, [...(groups.get(key) ?? []), change])
  }
  return [...groups.values()]
}

/**
 * Изменения, которые сервер не принял (ADR 0020): что это, почему и что с ними сделать.
 * Сюда ведёт полоса вверху экрана; здесь же видно, сколько ещё ждёт отправки.
 */
export function UnsentPage() {
  const { t } = useTranslation()
  const { online, queued, rejected, deferred } = useOfflineState()
  const groups = grouped(rejected)
  const missing = deferred.filter((item) => item.status === 'missing')

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('unsent.title')}</h1>
      {queued > 0 && (
        <p role="status">
          {t('unsent.queued', { count: queued })}
          {!online && (
            <span className="block text-sm text-muted-foreground">{t('unsent.offline')}</span>
          )}
        </p>
      )}
      {groups.length === 0 && missing.length === 0
        ? queued === 0 && <p className="text-muted-foreground">{t('unsent.empty')}</p>
        : groups.length > 0 && <p className="text-muted-foreground">{t('unsent.hint')}</p>}
      {groups.map((changes) => (
        <RejectedRow key={changes[0]!.seq} changes={changes} />
      ))}
      {missing.map((item) => (
        <MissingRow key={item.id} item={item} />
      ))}
    </div>
  )
}

function RejectedRow({ changes }: { changes: Rejected[] }) {
  const kind = changes[0]!.context.kind
  if (kind === 'entry' || kind === 'entryRemove') return <FoodRow change={changes[0]!} />
  if (kind === 'water' || kind === 'waterRemove') return <WaterRow change={changes[0]!} />
  return <WorkoutRow changes={changes} />
}

/** Строка отказа: иконка, что это, подробности, причина и действия. */
function Row({
  icon: Icon,
  title,
  detail,
  change,
  children,
}: {
  icon: typeof Dumbbell
  title: string
  detail?: string
  change: Rejected
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section className="grid gap-2 rounded-xl border p-4" aria-label={title}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="grid gap-0.5">
          <h2 className="font-medium">{title}</h2>
          {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
          <p className="text-sm text-destructive">{t(change.failure)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {children}
        <Button variant="ghost" className="h-11" onClick={() => void forget([change.seq])}>
          {t('unsent.remove')}
        </Button>
      </div>
    </section>
  )
}

/** Запись дневника. Продукт удалили, пока она ждала, — её заменяет запись с другим. */
function FoodRow({ change }: { change: Rejected }) {
  const { t } = useTranslation()
  const quantityText = useQuantityText()
  const mealName = useMealName()
  const { food, localDate } = change.context
  const day = useDiaryDay(localDate ?? '')
  const meal = day.data?.meals.find((item) => item.id === food?.mealId)
  const detail = food
    ? t('unsent.entryLine', {
        quantity: quantityText(food),
        meal: meal ? mealName(meal) : '',
        date: localDate ? isoToDisplay(localDate) : '',
      })
    : undefined
  const pick =
    change.failure === 'errors.product_not_found' && food?.mealId && localDate ? (
      <Button asChild variant="outline" className="h-11">
        <Link
          to="/diary/$date/add/$meal"
          params={{ date: localDate, meal: food.mealId }}
          search={{ replaces: change.seq }}
        >
          {t('unsent.pickProduct')}
        </Link>
      </Button>
    ) : undefined
  return (
    <Row
      icon={Utensils}
      title={food?.productName ?? t('unsent.changes', { count: 1 })}
      detail={detail}
      change={change}
    >
      {pick}
    </Row>
  )
}

/** Штрихкод не нашёлся (ADR 0020): продукт заполняют с упаковки, и запись вносится сразу. */
function MissingRow({ item }: { item: Deferred }) {
  const { t } = useTranslation()
  const mealName = useMealName()
  const amountText = useDeferredAmount()
  const day = useDiaryDay(item.localDate)
  const meal = day.data?.meals.find((value) => value.id === item.mealId)
  const title = t('deferred.barcode', { barcode: item.barcode })
  return (
    <section className="grid gap-2 rounded-xl border p-4" aria-label={title}>
      <div className="flex items-start gap-2">
        <ScanBarcode className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="grid gap-0.5">
          <h2 className="font-medium break-all">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {t('unsent.entryLine', {
              quantity: amountText(item),
              meal: meal ? mealName(meal) : '',
              date: isoToDisplay(item.localDate),
            })}
          </p>
          <p className="text-sm text-destructive">
            {t(item.missing?.status === 'draft' ? 'deferred.draft' : 'deferred.notFound')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-11">
          <Link to="/diary/$date/barcode/$id" params={{ date: item.localDate, id: item.id }}>
            {t('deferred.fill')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          className="h-11"
          onClick={() => void deferredBarcodes.remove(item.id)}
        >
          {t('unsent.remove')}
        </Button>
      </div>
    </section>
  )
}

function WaterRow({ change }: { change: Rejected }) {
  const { t } = useTranslation()
  const { waterMl, localDate } = change.context
  return (
    <Row
      icon={GlassWater}
      title={waterMl ? t('unsent.water', { amount: waterMl }) : t('unsent.changes', { count: 1 })}
      detail={localDate ? isoToDisplay(localDate) : undefined}
      change={change}
    />
  )
}

function WorkoutRow({ changes }: { changes: Rejected[] }) {
  const { t, i18n } = useTranslation()
  const user = useUser()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()
  const first = changes[0]!
  const sets = rejectedSets(changes).length
  const rest = first.context.kind === 'rest'
  const Icon = rest ? Timer : Dumbbell
  const title = rest
    ? t('unsent.rest')
    : first.context.startedAt
      ? t('unsent.workout', {
          date: formatDateTime(first.context.startedAt, i18n.language, user.timezone),
        })
      : t('unsent.workoutUnknown')

  async function move() {
    setBusy(true)
    setFailure(undefined)
    const result = await moveToNewWorkout(changes)
    setBusy(false)
    if ('failure' in result) return setFailure(result.failure)
    await client.invalidateQueries({ queryKey: WORKOUTS_KEY })
    await navigate({ to: '/workouts/$id', params: { id: result.id } })
  }

  return (
    <section className="grid gap-2 rounded-xl border p-4" aria-label={title}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="grid gap-0.5">
          <h2 className="font-medium">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {sets > 0
              ? t('unsent.sets', { count: sets })
              : t('unsent.changes', { count: changes.length })}
          </p>
          <p className="text-sm text-destructive">{t(first.failure)}</p>
        </div>
      </div>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {t(failure)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {sets > 0 && (
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => void move()}>
            {t('unsent.toNewWorkout')}
          </Button>
        )}
        <Button
          variant="ghost"
          className="h-11"
          disabled={busy}
          onClick={() => void forget(changes.map((change) => change.seq))}
        >
          {t('unsent.remove')}
        </Button>
      </div>
    </section>
  )
}
