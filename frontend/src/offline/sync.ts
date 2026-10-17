import { api } from '@/api/client'

import { copy } from './copy'
import { flush } from './queue'
import { offlineState } from './store'
import { WORKOUT_COPY, workoutCopy } from './workouts'

/** Как часто проверять связь, пока её нет или очередь не пуста. */
const PROBE_MS = 30_000

async function reachable(): Promise<boolean> {
  try {
    return (await api.GET('/api/health')).response.ok
  } catch {
    return false
  }
}

/**
 * Обновляет копию журнала тренировок — только при связи и пустой очереди: иначе ответ
 * сервера стёр бы изменения, которых он ещё не видел.
 */
export async function refreshCopy(): Promise<void> {
  const ready = () => offlineState.get().online && offlineState.get().queued === 0
  if (!ready()) return
  try {
    const [exercises, groups, list, recent] = await Promise.all([
      api.GET('/api/exercises'),
      api.GET('/api/workout-groups'),
      api.GET('/api/workouts'),
      api.GET('/api/workouts/recent'),
    ])
    // Пока шли запросы, могла появиться запись без сети.
    if (!ready()) return
    if (exercises.data) await copy.put(WORKOUT_COPY.exercises, exercises.data)
    if (groups.data) await copy.put(WORKOUT_COPY.groups, groups.data)
    if (list.data) await copy.put(WORKOUT_COPY.list, list.data)
    if (recent.data) await workoutCopy.replace(recent.data)
  } catch {
    // Сеть пропала посреди обновления — копия остаётся прежней.
  }
}

/**
 * Возвращает связь и отправляет очередь: по событию `online`, при разворачивании приложения
 * и раз в 30 секунд, пока связи нет или очередь не пуста (ADR 0020). `onSynced` вызывается,
 * когда связь вернулась и очередь опустела: экранам пора перечитать данные с сервера.
 */
export function startSync(onSynced: () => void): () => void {
  let stopped = false
  let busy = false

  async function attempt() {
    if (busy || stopped) return
    busy = true
    try {
      const wasOffline = !offlineState.get().online
      if (wasOffline) {
        if (!(await reachable())) return
        offlineState.setOnline(true)
      }
      const hadQueue = offlineState.get().queued > 0
      if (hadQueue && !(await flush())) return
      if ((wasOffline || hadQueue) && !stopped) {
        onSynced()
        await refreshCopy()
      }
    } finally {
      busy = false
    }
  }

  const tick = () => void attempt()
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(() => {
    const { online, queued } = offlineState.get()
    if (!online || queued > 0) tick()
  }, PROBE_MS)
  tick()
  void refreshCopy()

  return () => {
    stopped = true
    window.removeEventListener('online', tick)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(timer)
  }
}
