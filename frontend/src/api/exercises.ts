import { useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

import { api, type Schemas } from './client'

export type Exercise = Schemas['ExerciseOut']
export type PresetExercise = Schemas['PresetExerciseOut']
export type ExercisePreset = Schemas['ExercisePreset']
export type ExerciseKind = Schemas['ExerciseKind']
export type Muscle = Schemas['Muscle']

/** Список упражнений пользователя: добавление, правка и удаление сбрасывают его. */
export const EXERCISES_KEY = ['exercises'] as const

const NO_EXERCISES: Schemas['ExerciseListOut'] = { exercises: [], catalog: [] }

/** Упражнения пользователя по порядку, вместе с убранными, и справочник целиком. */
export function useExercises() {
  return useQuery({
    queryKey: EXERCISES_KEY,
    queryFn: async () => (await api.GET('/api/exercises')).data ?? NO_EXERCISES,
  })
}

/** Своё упражнение: создаёт, меняет название и мышцы или возвращает убранное в список. */
export function saveExercise(id: string, body: Schemas['ExerciseIn']) {
  return attempt(() =>
    api.PUT('/api/exercises/{exercise_id}', { params: { path: { exercise_id: id } }, body }),
  )
}

/** Ставит штатное упражнение в список: новое или убранное раньше. */
export function addPresetExercise(preset: ExercisePreset) {
  return attempt(() => api.POST('/api/exercises/presets', { body: { preset } }))
}

/** Убирает упражнение из списка; записанное по нему остаётся. */
export function deleteExercise(id: string) {
  return attempt(() =>
    api.DELETE('/api/exercises/{exercise_id}', { params: { path: { exercise_id: id } } }),
  )
}

/** Прогресс по завершённым тренировкам — сервер считает его из подходов. */
export function useExerciseProgress(id: string) {
  return useQuery({
    queryKey: ['exercise-progress', id],
    queryFn: async () =>
      (
        await api.GET('/api/exercises/{exercise_id}/progress', {
          params: { path: { exercise_id: id } },
        })
      ).data,
  })
}
