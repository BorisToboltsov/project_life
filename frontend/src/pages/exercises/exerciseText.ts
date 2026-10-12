import { useTranslation } from 'react-i18next'

import type { Exercise, ExerciseKind, ExercisePreset, Muscle } from '@/api/exercises'

/** То, что нужно экрану, чтобы показать упражнение: штатное из справочника или своё. */
export type Shown = Pick<Exercise, 'preset' | 'name' | 'kind' | 'muscles' | 'secondary'>

/**
 * Название упражнения: своего — как его назвал пользователь, штатного — на языке
 * интерфейса.
 */
export function useExerciseName(): (exercise: Pick<Exercise, 'preset' | 'name'>) => string {
  const { t } = useTranslation()
  return (exercise) =>
    exercise.name ?? (exercise.preset ? t(`exerciseNames.${exercise.preset}`) : '')
}

/** Мышцы одной строкой: «Квадрицепс, ягодицы». */
export function useMuscleList(): (muscles: Muscle[]) => string {
  const { t, i18n } = useTranslation()
  return (muscles) => {
    const [first, ...rest] = muscles.map((muscle) => t(`muscles.${muscle}`))
    if (first === undefined) return ''
    return [first, ...rest.map((name) => name.toLocaleLowerCase(i18n.language))].join(', ')
  }
}

/** Шаги техники штатного упражнения: в словаре — по строке на шаг. */
export function useSteps(): (preset: ExercisePreset) => string[] {
  const { t } = useTranslation()
  return (preset) => t(`exerciseSteps.${preset}`).split('\n')
}

/** Метки фильтра в списке упражнений, в порядке показа. */
export const GROUPS = [
  'all',
  'legs',
  'chest',
  'back',
  'shoulders',
  'arms',
  'core',
  'cardio',
] as const
export type Group = (typeof GROUPS)[number]

const GROUP_OF: Record<Muscle, Exclude<Group, 'all' | 'cardio'>> = {
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  chest: 'chest',
  lats: 'back',
  traps: 'back',
  lower_back: 'back',
  delts: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  abs: 'core',
  obliques: 'core',
}

/**
 * Подходит ли упражнение под метку: по мышцам, которые делают основную работу. Кардио
 * стоит только под своей меткой — иначе оно заняло бы «Ноги».
 */
export function inGroup(
  exercise: { kind: ExerciseKind; muscles: Muscle[] },
  group: Group,
): boolean {
  if (group === 'all') return true
  if (exercise.kind === 'cardio') return group === 'cardio'
  return exercise.muscles.some((muscle) => GROUP_OF[muscle] === group)
}

/** Что записывает подход, в порядке выбора в форме. */
export const KINDS = [
  'weight_reps',
  'reps',
  'time',
  'cardio',
] as const satisfies readonly ExerciseKind[]

/** Мышцы в порядке выбора в форме: сверху вниз, спереди и сзади. */
export const MUSCLES = [
  'chest',
  'delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'traps',
  'lats',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
] as const satisfies readonly Muscle[]
