import { useQuery } from '@tanstack/react-query'

import type { ChangeContext } from '@/offline/db'
import { fitnessCopy, fitnessOffline } from '@/offline/fitness'
import { readOr, write } from '@/offline/queue'
import { offlineState } from '@/offline/store'

import { api, type Schemas } from './client'

export type FitnessResult = Schemas['FitnessResultOut']
export type FitnessResultInput = Schemas['FitnessResultIn']

/** Результаты тестов: внесение, правка и удаление сбрасывают их. */
export const FITNESS_KEY = ['fitness-results'] as const

/**
 * Все результаты тестов, новые первыми: с сервера, а без сети и пока очередь не пуста — по
 * копии, где они лежат целиком вместе с теми, которых сервер ещё не видел (ADR 0020).
 */
export function useFitnessResults() {
  return useQuery({
    queryKey: FITNESS_KEY,
    networkMode: 'always',
    queryFn: async () => {
      const { online, queued } = offlineState.get()
      const load = () => api.GET('/api/fitness-results')
      return (
        (online && queued === 0 ? await readOr(load, fitnessOffline) : await fitnessOffline()) ?? []
      )
    },
  })
}

/** Что внесли — для строки «Не отправлено». */
function about(body: FitnessResultInput): ChangeContext['fitness'] {
  return {
    test: body.test,
    reps: body.reps ?? null,
    distance:
      body.distance_value != null && body.distance_unit
        ? { value: Number(body.distance_value), unit: body.distance_unit }
        : null,
  }
}

export async function saveFitnessResult(id: string, body: FitnessResultInput) {
  return write<FitnessResult>(
    {
      method: 'PUT',
      path: '/api/fitness-results/{result_id}',
      params: { result_id: id },
      body,
      context: { kind: 'fitness', localDate: body.local_date, fitness: about(body) },
    },
    () => fitnessCopy.save(id, body),
  )
}

/** Что удаляли — для строки «Не отправлено»: из копии, как результат виден на телефоне. */
async function aboutRemoval(id: string): Promise<ChangeContext> {
  const item = (await fitnessOffline()).find((row) => row.id === id)
  return {
    kind: 'fitnessRemove',
    ...(item && {
      localDate: item.local_date,
      fitness: {
        test: item.test,
        reps: item.reps,
        distance:
          item.distance_value !== null && item.distance_unit
            ? { value: item.distance_value, unit: item.distance_unit }
            : null,
      },
    }),
  }
}

export async function deleteFitnessResult(id: string) {
  return write(
    {
      method: 'DELETE',
      path: '/api/fitness-results/{result_id}',
      params: { result_id: id },
      context: await aboutRemoval(id),
    },
    () => fitnessCopy.remove(id),
  )
}
