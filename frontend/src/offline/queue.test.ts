import { describe, expect, it, vi } from 'vitest'

import { api } from '@/api/client'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { anna } from '@/test/fixtures'

import { copy } from './copy'
import { type Change, db } from './db'
import { enqueue, flush, readThrough, write } from './queue'
import { offlineSession } from './session'
import { offlineState } from './store'

const workout = '0199b7a0-0000-7000-8000-0000000000a1'
const item = '0199b7a0-0000-7000-8000-0000000000a2'

function setChange(setId: string, reps: number): Change {
  return {
    method: 'PUT',
    path: '/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}',
    params: { workout_id: workout, item_id: item, set_id: setId },
    body: { reps },
    context: { kind: 'set', workoutId: workout },
  }
}

const first = '0199b7a0-0000-7000-8000-0000000000c1'
const second = '0199b7a0-0000-7000-8000-0000000000c2'
const SETS = 'PUT /api/workouts/*'

describe('запись', () => {
  it('при связи уходит сразу и в очередь не встаёт', async () => {
    const calls = mockApi({ [SETS]: json(201, { id: first }) })
    const apply = vi.fn<() => Promise<void>>(async () => {})

    const result = await write(setChange(first, 5), apply)

    expect(result).toEqual({ data: { id: first } })
    expect(callsTo(calls, SETS)).toHaveLength(1)
    expect(await db.queue.count()).toBe(0)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('отказ сервера при связи возвращается экрану, а не встаёт в очередь', async () => {
    mockApi({ [SETS]: json(409, { detail: 'workout_finished' }) })

    const result = await write(setChange(first, 5), async () => {})

    expect(result).toEqual({ failure: 'errors.workout_finished' })
    expect(await db.queue.count()).toBe(0)
    expect(offlineState.get().online).toBe(true)
  })

  it.each([
    ['сеть недоступна', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['сервер недоступен', () => Promise.resolve(new Response(null, { status: 503 }))],
  ])('%s — изменение встаёт в очередь и вносится в копию', async (_name, respond) => {
    vi.stubGlobal('fetch', vi.fn(respond))
    const apply = vi.fn<() => Promise<void>>(async () => {})

    const result = await write(setChange(first, 5), apply)

    expect(result).toEqual({ queued: true })
    expect(apply).toHaveBeenCalledOnce()
    expect(offlineState.get()).toMatchObject({ online: false, queued: 1 })
    expect(offlineState.get().pending.has(first)).toBe(true)
  })

  it('без связи следующие изменения встают в очередь, не дожидаясь сети', async () => {
    offlineState.setOnline(false)
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)

    await write(setChange(first, 5), async () => {})

    expect(fetch).not.toHaveBeenCalled()
    expect(await db.queue.count()).toBe(1)
  })
})

describe('очередь', () => {
  it('повторная правка записи заменяет ждущую на её месте', async () => {
    await enqueue(setChange(first, 5))
    await enqueue(setChange(second, 6))
    await enqueue(setChange(first, 7))

    const queued = await db.queue.orderBy('seq').toArray()
    expect(queued.map((change) => [change.params.set_id, change.body])).toEqual([
      [first, { reps: 7 }],
      [second, { reps: 6 }],
    ])
  })

  it('удаление убирает ждущие изменения записи и всего, что в ней', async () => {
    await enqueue(setChange(first, 5))
    await enqueue({
      method: 'DELETE',
      path: '/api/workouts/{workout_id}/exercises/{item_id}',
      params: { workout_id: workout, item_id: item },
      context: { kind: 'workoutExerciseRemove', workoutId: workout },
    })

    const queued = await db.queue.toArray()
    expect(queued.map((change) => change.method)).toEqual(['DELETE'])
  })

  it('уходит по порядку; отказ ждёт решения, остальное идёт дальше', async () => {
    const calls = mockApi({
      [SETS]: sequence(json(201), json(409, { detail: 'workout_finished' }), json(201)),
      'DELETE /api/workouts/*': json(404, { detail: 'not_found' }),
    })
    const third = '0199b7a0-0000-7000-8000-0000000000c3'
    await enqueue(setChange(first, 5))
    await enqueue(setChange(second, 6))
    await enqueue(setChange(third, 7))
    await enqueue({
      method: 'DELETE',
      path: '/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}',
      params: {
        workout_id: workout,
        item_id: item,
        set_id: '0199b7a0-0000-7000-8000-0000000000c4',
      },
      context: { kind: 'setRemove', workoutId: workout },
    })

    expect(await flush()).toBe(true)

    expect(callsTo(calls, SETS).map((call) => call.path.split('/').at(-1))).toEqual([
      first,
      second,
      third,
    ])
    // Удалить то, чего уже нет, — тоже достигнутая цель.
    expect(await db.queue.count()).toBe(0)
    const rejected = await db.rejected.toArray()
    expect(rejected.map((change) => [change.params.set_id, change.failure])).toEqual([
      [second, 'errors.workout_finished'],
    ])
    expect(offlineState.get()).toMatchObject({ queued: 0, sending: false })
    expect(offlineState.get().rejected).toHaveLength(1)
  })

  it('обрыв связи посреди отправки оставляет очередь как есть', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await enqueue(setChange(first, 5))

    expect(await flush()).toBe(false)

    expect(await db.queue.count()).toBe(1)
    expect(await db.rejected.count()).toBe(0)
    expect(offlineState.get().online).toBe(false)
  })

  it('вход другого пользователя стирает очередь прежнего', async () => {
    await offlineSession.claim(anna)
    await enqueue(setChange(first, 5))

    await offlineSession.claim({ ...anna, id: '0199b7a0-0000-7000-8000-00000000beef' })

    expect(await db.queue.count()).toBe(0)
    expect(offlineState.get().queued).toBe(0)
  })
})

describe('чтение', () => {
  const load = () => api.GET('/api/workouts')

  it('с сервера кладёт ответ в копию, без связи отдаёт копию', async () => {
    mockApi({ 'GET /api/workouts': json(200, { workouts: [] }) })
    expect(await readThrough('workouts', load)).toEqual({ workouts: [] })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    expect(await readThrough('workouts', load)).toEqual({ workouts: [] })
    expect(offlineState.get().online).toBe(false)
  })

  it('пока очередь не пуста, копия главнее сервера', async () => {
    await copy.put('workouts', { workouts: [{ id: 'местное' }] })
    await enqueue(setChange(first, 5))
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)

    expect(await readThrough('workouts', load)).toEqual({ workouts: [{ id: 'местное' }] })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('без хранилища браузера', () => {
  it('экран со связью получает ответ сервера, а отложить изменение некуда — отказ', async () => {
    const put = vi.spyOn(db.copy, 'put').mockRejectedValue(new Error('IndexedDB is blocked'))
    const transaction = vi
      .spyOn(db, 'transaction')
      .mockRejectedValue(new Error('IndexedDB is blocked'))
    mockApi({ 'GET /api/workouts': json(200, { workouts: [] }) })

    expect(await readThrough('workouts', () => api.GET('/api/workouts'))).toEqual({ workouts: [] })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const result = await write(setChange(first, 5), async () => {})
    // База нужна следующему тесту: очистка после него её стирает.
    put.mockRestore()
    transaction.mockRestore()

    expect(result).toEqual({ failure: 'errors.network' })
  })
})
