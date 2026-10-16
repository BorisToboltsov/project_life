import { useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

import { api, type Schemas } from './client'

export type WorkoutGroup = Schemas['WorkoutGroupOut']
export type WorkoutGroupInput = Schemas['WorkoutGroupIn']
export const GROUPS_KEY = ['workout-groups'] as const

export function useWorkoutGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: async () => {
      const result = await attempt(() => api.GET('/api/workout-groups'))
      if (result.failure) throw new Error(result.failure)
      return result.data
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

export function startWorkoutGroup(id: string, body: Schemas['WorkoutRepeatIn']) {
  return attempt(() =>
    api.POST('/api/workout-groups/{group_id}/start', { params: { path: { group_id: id } }, body }),
  )
}
