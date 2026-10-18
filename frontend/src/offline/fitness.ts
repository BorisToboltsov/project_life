import type { Schemas } from '@/api/client'
import { METERS_PER_MILE } from '@/lib/fitness'

import { copy } from './copy'

type Result = Schemas['FitnessResultOut']

/** Ключ копии результатов тестов (ADR 0020). */
export const FITNESS_COPY = 'fitness-results'

/** Все результаты тестов, новые первыми, и метка, с которой их отдал сервер. */
export interface FitnessCopy {
  etag: string | null
  items: Result[]
}

/** Порядок сервера: новые дни первыми, в одном дне — позднее время первым. */
const newestFirst = (a: Result, b: Result) =>
  b.local_date.localeCompare(a.local_date) ||
  Date.parse(b.tested_at) - Date.parse(a.tested_at) ||
  a.id.localeCompare(b.id)

/** Результаты тестов по копии — тот же ответ, что `GET /api/fitness-results`. */
export async function fitnessOffline(): Promise<Result[]> {
  return (await copy.get<FitnessCopy>(FITNESS_COPY))?.items ?? []
}

async function edit(change: (items: Result[]) => Result[]): Promise<void> {
  await copy.update<FitnessCopy>(FITNESS_COPY, (current) =>
    current ? { ...current, items: change(current.items).sort(newestFirst) } : undefined,
  )
}

/** Изменения результатов в копии — те же, что делает сервер (ADR 0020). */
export const fitnessCopy = {
  async save(id: string, body: Schemas['FitnessResultIn']): Promise<void> {
    const value = body.distance_value == null ? null : Number(body.distance_value)
    const unit = body.distance_unit ?? null
    const item: Result = {
      id,
      test: body.test,
      tested_at: body.tested_at,
      local_date: body.local_date,
      reps: body.reps ?? null,
      distance_m: value === null ? null : unit === 'mi' ? value * METERS_PER_MILE : value,
      distance_value: value,
      distance_unit: unit,
      variant: body.variant ?? null,
    }
    await edit((items) => [...items.filter((row) => row.id !== id), item])
  },

  async remove(id: string): Promise<void> {
    await edit((items) => items.filter((row) => row.id !== id))
  },

  /** Все результаты, как их отдал сервер. */
  async replace(next: FitnessCopy): Promise<void> {
    await copy.put(FITNESS_COPY, next)
  },
}
