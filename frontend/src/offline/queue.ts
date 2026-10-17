import { api } from '@/api/client'
import { errorKey, type ErrorKey } from '@/lib/errors'

import { copy } from './copy'
import { type Change, db, recordPath } from './db'
import { offlineState } from './store'

/** Сколько ждать ответа, прежде чем считать, что сети нет (ADR 0020). */
export const TIMEOUT_MS = 5000

interface Sent {
  data?: unknown
  error?: unknown
  response: Response
}

/** Ответ, который значит «до сервера не достучаться», а не «сервер отказал». */
function unreachable(status: number): boolean {
  return status === 408 || status === 502 || status === 503 || status === 504
}

/**
 * Обещание, которое отклоняется, если не исполнилось за `TIMEOUT_MS`. Сам запрос не
 * прерывается: ответ, пришедший позже, ничего не ломает — повтор `PUT` заменит ту же запись.
 */
function inTime<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

type Call = (
  path: string,
  init: { params: { path: Record<string, string> }; body?: unknown },
) => Promise<Sent>

/** Изменение уходит тем же клиентом, что и запросы экранов: с токеном и его обновлением. */
function send(change: Change): Promise<Sent> {
  const call = api[change.method].bind(api) as unknown as Call
  return inTime(call(change.path, { params: { path: change.params }, body: change.body }))
}

/**
 * Ставит изменение в очередь. Повторный `PUT` той же записи заменяет ждущий, сохраняя его
 * место: строка тренировки по-прежнему уйдёт раньше своих подходов. `DELETE` убирает ждущие
 * изменения записи и всего, что в ней лежит.
 */
export async function enqueue(change: Change): Promise<void> {
  await db.transaction('rw', db.queue, async () => {
    const target = recordPath(change)
    const queued = await db.queue.toArray()
    if (change.method === 'DELETE') {
      const inside = queued.filter((item) => {
        const path = recordPath(item)
        return path === target || path.startsWith(`${target}/`)
      })
      await db.queue.bulkDelete(inside.map((item) => item.seq!))
    }
    const same = queued.find((item) => item.method === 'PUT' && recordPath(item) === target)
    if (change.method === 'PUT' && same) {
      await db.queue.update(same.seq!, { body: change.body, context: change.context })
      return
    }
    await db.queue.add(change)
  })
  await offlineState.reload()
}

export interface Written<T> {
  data?: T
  /** Изменение легло в очередь и уйдёт, когда вернётся связь. */
  queued?: boolean
  failure?: ErrorKey
}

/**
 * Изменение для сервера: сразу, если связь есть и очередь пуста, иначе — в очередь (ADR 0020).
 * `apply` вносит его в копию на устройстве, чтобы экран без сети видел его на своём месте.
 * Отказ сервера при живой связи возвращается экрану, как и прежде.
 */
export async function write<T>(change: Change, apply: () => Promise<void>): Promise<Written<T>> {
  const { online, queued } = offlineState.get()
  if (online && queued === 0) {
    try {
      const { data, error, response } = await send(change)
      if (response.ok) {
        await applySafely(apply)
        return { data: data as T }
      }
      if (!unreachable(response.status)) return { failure: errorKey(error) }
    } catch {
      // Сеть не ответила вовремя — дальше без неё.
    }
    offlineState.setOnline(false)
  }
  try {
    await enqueue(change)
  } catch {
    // Хранилище браузера недоступно: отложить изменение некуда.
    return { failure: 'errors.network' }
  }
  await applySafely(apply)
  return { queued: true }
}

/** Копии может не хватать данных — тогда экран просто не увидит изменения до отправки. */
async function applySafely(apply: () => Promise<void>): Promise<void> {
  try {
    await apply()
  } catch {
    // Изменение уже у сервера или в очереди: копия догонит его при следующем обновлении.
  }
}

/**
 * Чтение для экрана, который работает без сети: с сервера с сохранением ответа в копию, а
 * без связи — из копии. Пока очередь не пуста, копия главнее сервера: в ней есть изменения,
 * которых сервер ещё не видел. `undefined` — записи нет ни там, ни там.
 */
export async function readThrough<T>(
  key: string,
  load: () => Promise<{ data?: T; response: Response }>,
): Promise<T | undefined> {
  const { online, queued } = offlineState.get()
  if (!online) return copy.get<T>(key)
  if (queued > 0) {
    const local = await copy.get<T>(key)
    if (local !== undefined) return local
  }
  try {
    const { data, response } = await inTime(load())
    if (data !== undefined) {
      await copy.put(key, data)
      return data
    }
    if (!unreachable(response.status)) return undefined
  } catch {
    // Сеть не ответила вовремя — показываем копию.
  }
  offlineState.setOnline(false)
  return copy.get<T>(key)
}

let draining: Promise<boolean> | null = null

/** Отправляет очередь по порядку. `true` — очередь опустела. */
export function flush(): Promise<boolean> {
  draining ??= drain().finally(() => {
    draining = null
    offlineState.setSending(false)
  })
  return draining
}

async function drain(): Promise<boolean> {
  offlineState.setSending(true)
  for (;;) {
    const change = await db.queue.orderBy('seq').first()
    if (!change) return true
    let sent: Sent
    try {
      sent = await send(change)
    } catch {
      offlineState.setOnline(false)
      return false
    }
    const { error, response } = sent
    // Удалённое раньше — уже удалено: повтор `DELETE` своей цели достиг.
    if (response.ok || (change.method === 'DELETE' && response.status === 404)) {
      await db.queue.delete(change.seq!)
    } else if (unreachable(response.status)) {
      offlineState.setOnline(false)
      return false
    } else if (response.status === 401 || response.status === 429) {
      // Сессия закрыта или сервер просит подождать: очередь ждёт следующей попытки.
      return false
    } else {
      await db.transaction('rw', db.queue, db.rejected, async () => {
        await db.queue.delete(change.seq!)
        await db.rejected.put({ ...change, seq: change.seq!, failure: errorKey(error) })
      })
    }
    await offlineState.reload()
  }
}

/** Убирает отклонённые изменения: человек решил, что они не нужны, или перенёс их. */
export async function forget(seqs: number[]): Promise<void> {
  await db.rejected.bulkDelete(seqs)
  await offlineState.reload()
}
