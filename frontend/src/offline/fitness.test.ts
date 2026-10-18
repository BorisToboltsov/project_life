import { describe, expect, it, vi } from 'vitest'

import type { FitnessResult } from '@/api/fitness'

import { copy } from './copy'
import { FITNESS_COPY, type FitnessCopy, fitnessCopy, fitnessOffline } from './fitness'
import { refreshCopy } from './sync'

const NEW_ID = '0199b7a0-0000-7000-8000-00000000fa01'

function pullUps(
  date: string,
  reps: number,
  id = `0199b7a0-0000-7000-8000-0000${date.replaceAll('-', '')}`,
) {
  return {
    id,
    test: 'pull_ups',
    tested_at: `${date}T09:00:00Z`,
    local_date: date,
    reps,
    distance_m: null,
    distance_value: null,
    distance_unit: null,
    variant: null,
  } satisfies FitnessResult
}

async function seed(items: FitnessResult[]) {
  await copy.put(FITNESS_COPY, { etag: '"1"', items } satisfies FitnessCopy)
}

describe('результаты тестов в копии', () => {
  it('Купер в милях ложится в метрах и встаёт на своё место по дате', async () => {
    const older = pullUps('2026-09-01', 9)
    const newer = pullUps('2026-10-10', 11)
    await seed([newer, older])

    await fitnessCopy.save(NEW_ID, {
      test: 'cooper',
      tested_at: '2026-10-05T07:00:00.000Z',
      local_date: '2026-10-05',
      distance_value: '1.65',
      distance_unit: 'mi',
    })

    const items = await fitnessOffline()
    expect(items.map((item) => item.local_date)).toEqual(['2026-10-10', '2026-10-05', '2026-09-01'])
    expect(items[1]).toEqual({
      id: NEW_ID,
      test: 'cooper',
      tested_at: '2026-10-05T07:00:00.000Z',
      local_date: '2026-10-05',
      reps: null,
      distance_m: 1.65 * 1609.344,
      distance_value: 1.65,
      distance_unit: 'mi',
      variant: null,
    })
  })

  it('повтор под тем же ключом заменяет результат, удаление убирает его', async () => {
    const item = pullUps('2026-10-10', 11)
    await seed([item])

    await fitnessCopy.save(item.id, {
      test: 'pull_ups',
      tested_at: item.tested_at,
      local_date: item.local_date,
      reps: 12,
    })
    expect((await fitnessOffline()).map((row) => row.reps)).toEqual([12])

    await fitnessCopy.remove(item.id)
    expect(await fitnessOffline()).toEqual([])
  })

  it('без копии запись в неё не попадает: неполную историю не выдать за полную', async () => {
    await fitnessCopy.save(NEW_ID, {
      test: 'push_ups',
      tested_at: '2026-10-10T07:00:00.000Z',
      local_date: '2026-10-10',
      reps: 30,
      variant: 'knee',
    })

    expect(await copy.get(FITNESS_COPY)).toBeUndefined()
  })
})

describe('обновление копии результатов', () => {
  it('берёт все результаты, а неизменные — ответом 304 по метке', async () => {
    const items = [pullUps('2026-10-10', 11)]
    const asked: (string | null)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        if (new URL(request.url).pathname !== '/api/fitness-results')
          return new Response(null, { status: 404 })
        asked.push(request.headers.get('If-None-Match'))
        if (request.headers.get('If-None-Match') === '"a"')
          return new Response(null, { status: 304, headers: { ETag: '"a"' } })
        return Response.json(items, { headers: { ETag: '"a"' } })
      }),
    )

    await refreshCopy()
    await refreshCopy()

    expect(asked).toEqual([null, '"a"'])
    expect(await copy.get(FITNESS_COPY)).toEqual({ etag: '"a"', items })
  })
})
