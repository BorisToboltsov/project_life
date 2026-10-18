import { api } from '@/api/client'

import { copy } from './copy'
import { resolveDeferred } from './deferred'
import { type CatalogCopy, DIARY_COPY, diaryCopy } from './diary'
import { flush } from './queue'
import { offlineState } from './store'
import { WORKOUT_COPY, workoutCopy } from './workouts'

/** Как часто проверять связь, пока её нет, очередь не пуста или штрихкоды ждут поиска. */
const PROBE_MS = 30_000

const waiting = () => offlineState.get().deferred.filter((item) => item.status === 'waiting').length

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
    // В копию идёт только ответ ожидаемой формы: чужой ответ сломал бы экраны без сети.
    if (Array.isArray(exercises.data?.exercises))
      await copy.put(WORKOUT_COPY.exercises, exercises.data)
    if (Array.isArray(groups.data?.groups)) await copy.put(WORKOUT_COPY.groups, groups.data)
    if (Array.isArray(list.data?.workouts)) await copy.put(WORKOUT_COPY.list, list.data)
    if (recent.data && Array.isArray(recent.data.workouts) && Array.isArray(recent.data.latest))
      await workoutCopy.replace(recent.data)
    await refreshDiary(ready)
  } catch {
    // Сеть пропала посреди обновления — копия остаётся прежней.
  }
}

/**
 * Копия дневника: каталог целиком — заново, только если он изменился (`ETag`), последние
 * дни, действующая цель и подсказки каждого приёма пищи.
 */
async function refreshDiary(ready: () => boolean): Promise<void> {
  const known = await copy.get<CatalogCopy>(DIARY_COPY.catalog)
  const [catalog, days, goal] = await Promise.all([
    api.GET('/api/products/catalog', {
      headers: known?.etag ? { 'If-None-Match': known.etag } : {},
    }),
    api.GET('/api/diary/recent'),
    api.GET('/api/diary/goal'),
  ])
  const recentDays = Array.isArray(days.data) ? days.data : undefined
  const meals = recentDays?.[0]?.meals.filter((meal) => !meal.archived) ?? []
  const suggestions = await Promise.all(
    meals.map(async (meal) => ({
      meal: meal.id,
      lists: (await api.GET('/api/diary/suggestions', { params: { query: { meal_id: meal.id } } }))
        .data,
    })),
  )
  if (!ready()) return
  if (Array.isArray(catalog.data))
    await copy.put(DIARY_COPY.catalog, {
      etag: catalog.response.headers.get('ETag'),
      products: catalog.data,
    } satisfies CatalogCopy)
  if (recentDays) await diaryCopy.replaceDays(recentDays)
  if (goal.response.ok) await copy.put(DIARY_COPY.goal, goal.data ?? null)
  for (const { meal, lists } of suggestions) {
    if (Array.isArray(lists?.recent)) await copy.put(DIARY_COPY.suggestions(meal), lists)
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
      // Незнакомые штрихкоды ищутся, когда очередь ушла: найденное ляжет поверх отправленного.
      const found = waiting() > 0 && !stopped && (await resolveDeferred())
      if ((wasOffline || hadQueue || found) && !stopped) {
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
    if (!online || queued > 0 || waiting() > 0) tick()
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
