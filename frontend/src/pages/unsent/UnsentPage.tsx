import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Dumbbell, Timer } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { WORKOUTS_KEY } from '@/api/workouts'
import { useUser } from '@/auth/useSession'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import type { Rejected } from '@/offline/db'
import { forget } from '@/offline/queue'
import { useOfflineState } from '@/offline/store'

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
  const { online, queued, rejected } = useOfflineState()
  const groups = grouped(rejected)

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
      {groups.length === 0 ? (
        queued === 0 && <p className="text-muted-foreground">{t('unsent.empty')}</p>
      ) : (
        <p className="text-muted-foreground">{t('unsent.hint')}</p>
      )}
      {groups.map((changes) => (
        <RejectedRow key={changes[0]!.seq} changes={changes} />
      ))}
    </div>
  )
}

function RejectedRow({ changes }: { changes: Rejected[] }) {
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
