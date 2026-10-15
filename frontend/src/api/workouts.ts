import { useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

import { api, type Schemas } from './client'

export type Workout = Schemas['WorkoutOut']
export type WorkoutDetail = Schemas['WorkoutDetailOut']
export type WorkoutExercise = Schemas['WorkoutExerciseOut']
export type WorkoutSet = Schemas['WorkoutSetOut']
export type WorkoutSetInput = Schemas['WorkoutSetIn']

export const WORKOUTS_KEY = ['workouts'] as const
export const workoutKey = (id: string) => ['workouts', id] as const

export function useWorkouts() {
  return useQuery({
    queryKey: WORKOUTS_KEY,
    queryFn: async () => (await api.GET('/api/workouts')).data?.workouts ?? [],
  })
}

export function useWorkout(id: string) {
  return useQuery({
    queryKey: workoutKey(id),
    queryFn: async () =>
      (
        await api.GET('/api/workouts/{workout_id}', {
          params: { path: { workout_id: id } },
        })
      ).data,
  })
}

export function saveWorkout(id: string, body: Schemas['WorkoutIn']) {
  return attempt(() =>
    api.PUT('/api/workouts/{workout_id}', {
      params: { path: { workout_id: id } },
      body,
    }),
  )
}

export function finishWorkout(id: string, finishedAt: string) {
  return attempt(() =>
    api.POST('/api/workouts/{workout_id}/finish', {
      params: { path: { workout_id: id } },
      body: { finished_at: finishedAt },
    }),
  )
}

export function repeatWorkout(sourceId: string, body: Schemas['WorkoutRepeatIn']) {
  return attempt(() =>
    api.POST('/api/workouts/{workout_id}/repeat', {
      params: { path: { workout_id: sourceId } },
      body,
    }),
  )
}

export function deleteWorkout(id: string) {
  return attempt(() =>
    api.DELETE('/api/workouts/{workout_id}', {
      params: { path: { workout_id: id } },
    }),
  )
}

export function addWorkoutExercise(id: string, itemId: string, exerciseId: string) {
  return attempt(() =>
    api.PUT('/api/workouts/{workout_id}/exercises/{item_id}', {
      params: { path: { workout_id: id, item_id: itemId } },
      body: { exercise_id: exerciseId },
    }),
  )
}

export function removeWorkoutExercise(id: string, itemId: string) {
  return attempt(() =>
    api.DELETE('/api/workouts/{workout_id}/exercises/{item_id}', {
      params: { path: { workout_id: id, item_id: itemId } },
    }),
  )
}

export function saveWorkoutSet(id: string, itemId: string, setId: string, body: WorkoutSetInput) {
  return attempt(() =>
    api.PUT('/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}', {
      params: { path: { workout_id: id, item_id: itemId, set_id: setId } },
      body,
    }),
  )
}

export function removeWorkoutSet(id: string, itemId: string, setId: string) {
  return attempt(() =>
    api.DELETE('/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}', {
      params: { path: { workout_id: id, item_id: itemId, set_id: setId } },
    }),
  )
}

export function saveExerciseRest(exerciseId: string, seconds: number) {
  return attempt(() =>
    api.PUT('/api/exercises/{exercise_id}/rest', {
      params: { path: { exercise_id: exerciseId } },
      body: { rest_seconds: seconds },
    }),
  )
}
