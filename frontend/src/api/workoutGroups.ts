import { useQuery } from '@tanstack/react-query'

import { today } from '@/lib/dates'
import { attempt } from '@/lib/errors'
import { readThrough, write } from '@/offline/queue'
import { offlineState } from '@/offline/store'
import { plannedOn, WORKOUT_COPY, workoutCopy } from '@/offline/workouts'

import { api, type Schemas } from './client'

export type WorkoutGroup = Schemas['WorkoutGroupOut']
export type WorkoutGroupInput = Schemas['WorkoutGroupIn']
export const GROUPS_KEY = ['workout-groups'] as const

/** Группы и план на сегодня; без сети — из копии, с планом на сегодняшний день (ADR 0020). */
export function useWorkoutGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    networkMode: 'always',
    queryFn: async () => {
      const groups = await readThrough(WORKOUT_COPY.groups, () => api.GET('/api/workout-groups'))
      if (!groups) throw new Error('groups unavailable')
      return offlineState.get().online ? groups : plannedOn(groups, today())
    },
    refetchInterval: 60_000,
  })
}

export function saveWorkoutGroup(id: string, body: WorkoutGroupInput) {
  return attempt(() =>
    api.PUT('/api/workout-groups/{group_id}', { params: { path: { group_id: id } }, body }),
  )
}

export function deleteWorkoutGroup(id: string) {
  return attempt(() =>
    api.DELETE('/api/workout-groups/{group_id}', { params: { path: { group_id: id } } }),
  )
}

/** Запуск группы; `exercise_ids` — какой состав видел человек (ADR 0020). */
export function startWorkoutGroup(id: string, body: Schemas['WorkoutRepeatIn']) {
  return write<Schemas['WorkoutOut']>(
    {
      method: 'POST',
      path: '/api/workout-groups/{group_id}/start',
      params: { group_id: id },
      body,
      context: {
        kind: 'groupStart',
        workoutId: body.id,
        startedAt: body.started_at,
        localDate: body.local_date,
      },
    },
    () => workoutCopy.startGroup(id, body),
  )
}
