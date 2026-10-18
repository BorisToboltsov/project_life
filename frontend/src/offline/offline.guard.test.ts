import { describe, expect, it, vi } from 'vitest'

import { json, mockApi } from '@/test/api'

import { type Change, db } from './db'
import { deferredBarcodes, resolveDeferred } from './deferred'
import { enqueue, flush, forget } from './queue'

const sources = import.meta.glob<string>('/src/api/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Модули, где через очередь идёт любая запись: так записывается без сети (ADR 0020). */
const OFFLINE_MODULES = ['/src/api/workouts.ts']

/** Отдельные функции других модулей, которые тоже работают без сети. */
const OFFLINE_FUNCTIONS: [string, string][] = [
  ['/src/api/workoutGroups.ts', 'startWorkoutGroup'],
  ['/src/api/nutrition.ts', 'saveEntry'],
  ['/src/api/nutrition.ts', 'deleteEntry'],
  ['/src/api/nutrition.ts', 'saveWater'],
  ['/src/api/nutrition.ts', 'deleteWater'],
]

/** Тело экспортированной функции: от её объявления до следующего объявления. */
function body(code: string, name: string): string {
  const start = code.search(new RegExp(`export (async )?function ${name}\\b`))
  if (start < 0) return ''
  const next = code.slice(start + 1).search(/\nexport /)
  return next < 0 ? code.slice(start) : code.slice(start, start + 1 + next)
}

const direct = /api\.(PUT|POST|DELETE|PATCH)\(/

// Гейт I20: записанное без сети не теряется молча.
describe('запись без сети', () => {
  it.each(OFFLINE_MODULES)('%s пишет только через очередь', (path) => {
    const code = sources[path] ?? ''

    expect(code).toMatch(/\bwrite[<(]/)
    expect(code.match(direct)?.[0] ?? null).toBeNull()
  })

  it.each(OFFLINE_FUNCTIONS)('%s: %s пишет через очередь', (path, name) => {
    const text = body(sources[path] ?? '', name)

    expect(text).toMatch(/\bwrite[<(]/)
    expect(text.match(direct)?.[0] ?? null).toBeNull()
  })

  const change: Change = {
    method: 'PUT',
    path: '/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}',
    params: {
      workout_id: '0199b7a0-0000-7000-8000-0000000000a1',
      item_id: '0199b7a0-0000-7000-8000-0000000000a2',
      set_id: '0199b7a0-0000-7000-8000-0000000000c1',
    },
    body: { reps: 5 },
    context: { kind: 'set' },
  }

  it('изменение остаётся на устройстве, пока сервер его не принял', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await enqueue(change)
    expect(await flush()).toBe(false)
    mockApi({ 'PUT /api/workouts/*': json(503) })
    expect(await flush()).toBe(false)

    expect(await db.queue.count()).toBe(1)
  })

  it('отклонённое ждёт решения человека, а не исчезает', async () => {
    mockApi({ 'PUT /api/workouts/*': json(409, { detail: 'workout_finished' }) })
    await enqueue(change)

    await flush()

    const [rejected] = await db.rejected.toArray()
    expect(rejected).toMatchObject({ body: change.body, failure: 'errors.workout_finished' })
    await forget([rejected!.seq])
    expect(await db.rejected.count()).toBe(0)
  })
})

describe('отложенный штрихкод', () => {
  it.each(['not_found', 'draft', 'unavailable'])(
    'поиск с исходом %s не стирает запись: она ждёт решения или следующей попытки',
    async (status) => {
      await deferredBarcodes.add({
        id: '0199b7a0-0000-7000-8000-0000000000f1',
        barcode: '4601000000012',
        localDate: '2026-10-18',
        mealId: '0199b7a0-0000-7000-8000-0000000000a2',
        amount: { packages: 1 },
      })
      mockApi({
        'POST /api/products/lookup': json(200, { status, barcode: '4601000000012' }),
      })

      await resolveDeferred()

      expect(await db.deferred.count()).toBe(1)
    },
  )
})
