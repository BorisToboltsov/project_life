import { useQuery } from '@tanstack/react-query'

import { copy } from '@/offline/copy'
import type { ChangeContext, ChangeKind } from '@/offline/db'
import { readThrough, write } from '@/offline/queue'
import { WORKOUT_COPY, workoutCopy } from '@/offline/workouts'

import { api, type Schemas } from './client'

export type Workout = Schemas['WorkoutOut']
export type WorkoutDetail = Schemas['WorkoutDetailOut']
export type WorkoutExercise = Schemas['WorkoutExerciseOut']
export type WorkoutSet = Schemas['WorkoutSetOut']
export type WorkoutSetInput = Schemas['WorkoutSetIn']

export const WORKOUTS_KEY = ['workouts'] as const
export const workoutKey = (id: string) => ['workouts', id] as const

// Журнал тренировок работает и без сети (ADR 0020): чтение идёт через копию на устройстве,
// изменения при обрыве связи встают в очередь и сразу вносятся в копию.

export function useWorkouts() {
  return useQuery({
    queryKey: WORKOUTS_KEY,
    networkMode: 'always',
    queryFn: async () =>
      (await readThrough(WORKOUT_COPY.list, () => api.GET('/api/workouts')))?.workouts ?? [],
  })
}

export function useWorkout(id: string) {
  return useQuery({
    queryKey: workoutKey(id),
    networkMode: 'always',
    queryFn: async () =>
      (await readThrough(WORKOUT_COPY.detail(id), () =>
        api.GET('/api/workouts/{workout_id}', { params: { path: { workout_id: id } } }),
      )) ?? null,
  })
}

/** К какой тренировке и упражнению относится изменение — для экрана «Не отправлено». */
async function about(kind: ChangeKind, workoutId: string, itemId?: string): Promise<ChangeContext> {
  const detail = await copy.get<WorkoutDetail>(WORKOUT_COPY.detail(workoutId))
  return {
    kind,
    workoutId,
    startedAt: detail?.started_at,
    localDate: detail?.local_date,
    exerciseId: detail?.exercises.find((item) => item.id === itemId)?.exercise.id,
  }
}

export async function saveWorkout(id: string, body: Schemas['WorkoutIn']) {
  return write<Workout>(
    {
      method: 'PUT',
      path: '/api/workouts/{workout_id}',
      params: { workout_id: id },
      body,
      context: {
        kind: 'workout',
        workoutId: id,
        startedAt: body.started_at,
        localDate: body.local_date,
      },
    },
    () => workoutCopy.save(id, body),
  )
}

export async function finishWorkout(id: string, finishedAt: string) {
  return write<Workout>(
    {
      method: 'POST',
      path: '/api/workouts/{workout_id}/finish',
      params: { workout_id: id },
      body: { finished_at: finishedAt },
      context: await about('workoutFinish', id),
    },
    () => workoutCopy.finish(id, finishedAt),
  )
}

/** Повтор тренировки; `exercise_ids` — какой состав видел человек (ADR 0020). */
export async function repeatWorkout(sourceId: string, body: Schemas['WorkoutRepeatIn']) {
  return write<Workout>(
    {
      method: 'POST',
      path: '/api/workouts/{workout_id}/repeat',
      params: { workout_id: sourceId },
      body,
      context: {
        kind: 'workoutRepeat',
        workoutId: body.id,
        startedAt: body.started_at,
        localDate: body.local_date,
      },
    },
    () => workoutCopy.repeat(sourceId, body),
  )
}

export async function deleteWorkout(id: string) {
  return write(
    {
      method: 'DELETE',
      path: '/api/workouts/{workout_id}',
      params: { workout_id: id },
      context: await about('workoutDelete', id),
    },
    () => workoutCopy.remove(id),
  )
}

export async function addWorkoutExercise(id: string, itemId: string, exerciseId: string) {
  return write<WorkoutExercise>(
    {
      method: 'PUT',
      path: '/api/workouts/{workout_id}/exercises/{item_id}',
      params: { workout_id: id, item_id: itemId },
      body: { exercise_id: exerciseId },
      context: { ...(await about('workoutExercise', id)), exerciseId },
    },
    () => workoutCopy.addExercise(id, itemId, exerciseId),
  )
}

export async function removeWorkoutExercise(id: string, itemId: string) {
  return write(
    {
      method: 'DELETE',
      path: '/api/workouts/{workout_id}/exercises/{item_id}',
      params: { workout_id: id, item_id: itemId },
      context: await about('workoutExerciseRemove', id, itemId),
    },
    () => workoutCopy.removeExercise(id, itemId),
  )
}

export async function saveWorkoutSet(
  id: string,
  itemId: string,
  setId: string,
  body: WorkoutSetInput,
) {
  return write<WorkoutSet>(
    {
      method: 'PUT',
      path: '/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}',
      params: { workout_id: id, item_id: itemId, set_id: setId },
      body,
      context: await about('set', id, itemId),
    },
    () => workoutCopy.saveSet(id, itemId, setId, body),
  )
}

export async function removeWorkoutSet(id: string, itemId: string, setId: string) {
  return write(
    {
      method: 'DELETE',
      path: '/api/workouts/{workout_id}/exercises/{item_id}/sets/{set_id}',
      params: { workout_id: id, item_id: itemId, set_id: setId },
      context: await about('setRemove', id, itemId),
    },
    () => workoutCopy.removeSet(id, itemId, setId),
  )
}

export async function saveExerciseRest(exerciseId: string, seconds: number) {
  return write<Schemas['ExerciseOut']>(
    {
      method: 'PUT',
      path: '/api/exercises/{exercise_id}/rest',
      params: { exercise_id: exerciseId },
      body: { rest_seconds: seconds },
      context: { kind: 'rest', exerciseId },
    },
    () => workoutCopy.rest(exerciseId, seconds),
  )
}
