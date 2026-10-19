import { api } from '@/api/client'

import { copy } from './copy'
import { resolveDeferred } from './deferred'
import { type CatalogCopy, DIARY_COPY, diaryCopy } from './diary'
import { FITNESS_COPY, type FitnessCopy, fitnessCopy } from './fitness'
import { LAB_COPY, labCopy, type LabReportsCopy } from './labs'
import { MEASUREMENT_COPY, type MeasurementsCopy, measurementsCopy } from './measurements'
import { PRESSURE_COPY, type PressureCopy, pressureCopy } from './pressure'
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
 * Обновляет копию — журнал тренировок, дневник, замеры, давление, тесты и анализы — только
 * при связи и пустой
 * очереди: иначе ответ сервера стёр бы изменения, которых он ещё не видел. `alive` —
 * отправка ещё работает: после выхода обновление не запрашивает и не пишет дальше.
 */
export async function refreshCopy(alive: () => boolean = () => true): Promise<void> {
  const ready = () => alive() && offlineState.get().online && offlineState.get().queued === 0
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
    await refreshMeasurements(ready)
    await refreshFitness(ready)
    await refreshPressure(ready)
    await refreshLabs(ready)
  } catch {
    // Сеть пропала посреди обновления — копия остаётся прежней.
  }
}

/**
 * Копия дневника: каталог целиком — заново, только если он изменился (`ETag`), последние
 * дни, действующая цель и подсказки каждого приёма пищи.
 */
async function refreshDiary(ready: () => boolean): Promise<void> {
  if (!ready()) return
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

/** Копия замеров: свой список видов и все замеры — заново, только если они изменились. */
async function refreshMeasurements(ready: () => boolean): Promise<void> {
  if (!ready()) return
  const known = await copy.get<MeasurementsCopy>(MEASUREMENT_COPY.all)
  const [metrics, all] = await Promise.all([
    api.GET('/api/metrics'),
    api.GET('/api/measurements/all', {
      headers: known?.etag ? { 'If-None-Match': known.etag } : {},
    }),
  ])
  if (!ready()) return
  if (Array.isArray(metrics.data?.metrics)) await copy.put(MEASUREMENT_COPY.metrics, metrics.data)
  if (Array.isArray(all.data))
    await measurementsCopy.replace({ etag: all.response.headers.get('ETag'), items: all.data })
}

/** Копия результатов тестов: все результаты — заново, только если они изменились. */
async function refreshFitness(ready: () => boolean): Promise<void> {
  if (!ready()) return
  const known = await copy.get<FitnessCopy>(FITNESS_COPY)
  const all = await api.GET('/api/fitness-results', {
    headers: known?.etag ? { 'If-None-Match': known.etag } : {},
  })
  if (!ready()) return
  if (Array.isArray(all.data))
    await fitnessCopy.replace({ etag: all.response.headers.get('ETag'), items: all.data })
}

/** Копия показаний давления: все показания — заново, только если они изменились. */
async function refreshPressure(ready: () => boolean): Promise<void> {
  if (!ready()) return
  const known = await copy.get<PressureCopy>(PRESSURE_COPY)
  const all = await api.GET('/api/blood-pressure', {
    headers: known?.etag ? { 'If-None-Match': known.etag } : {},
  })
  if (!ready()) return
  if (Array.isArray(all.data))
    await pressureCopy.replace({ etag: all.response.headers.get('ETag'), items: all.data })
}

/** Копия анализов: свои показатели со справочником и все бланки — заново, если изменились. */
async function refreshLabs(ready: () => boolean): Promise<void> {
  if (!ready()) return
  const known = await copy.get<LabReportsCopy>(LAB_COPY.reports)
  const [analytes, reports] = await Promise.all([
    api.GET('/api/lab-analytes'),
    api.GET('/api/lab-reports', {
      headers: known?.etag ? { 'If-None-Match': known.etag } : {},
    }),
  ])
  if (!ready()) return
  if (Array.isArray(analytes.data?.catalog)) await copy.put(LAB_COPY.analytes, analytes.data)
  if (Array.isArray(reports.data))
    await labCopy.replaceReports({
      etag: reports.response.headers.get('ETag'),
      items: reports.data,
    })
}

/**
 * Возвращает связь и отправляет очередь: по событию `online`, при разворачивании приложения
 * и раз в 30 секунд, пока связи нет или очередь не пуста (ADR 0020). `onSynced` вызывается,
 * когда связь вернулась и очередь опустела: экранам пора перечитать данные с сервера.
 */
export function startSync(onSynced: () => void): () => void {
  let stopped = false
  let busy = false
  const alive = () => !stopped

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
        await refreshCopy(alive)
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
  void refreshCopy(alive)

  return () => {
    stopped = true
    window.removeEventListener('online', tick)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(timer)
  }
}
