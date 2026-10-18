import type { Schemas } from '@/api/client'

import { ageOn } from './dates'

export type FitnessTest = Schemas['FitnessTest']
export type PushUpVariant = Schemas['PushUpVariant']
type Sex = Schemas['Sex']

/** Тесты в порядке карточки «Тесты». */
export const FITNESS_TESTS = [
  'cooper',
  'push_ups',
  'pull_ups',
] as const satisfies readonly FitnessTest[]

/** Длительность теста Купера. */
export const COOPER_SECONDS = 12 * 60

/** Метров в миле: дистанцию Купера вводят в милях по профилю. */
export const METERS_PER_MILE = 1609.344

/** Пределы дистанции Купера в метрах — те же, что принимает сервер. */
export const COOPER_MIN_M = 600
export const COOPER_MAX_M = 6000

export const REPS_MAX = 1000

/** VO2max по дистанции теста Купера, мл/кг/мин (Cooper, 1968): (метры − 504,9) / 44,73. */
export function vo2max(distanceM: number): number {
  return (distanceM - 504.9) / 44.73
}

/** Шкала норм: у таблицы Купера и у CPAFLA свои названия ступеней. */
export type Scale = 'cooper' | 'cpafla'

/** Ступени шкалы снизу вверх: индекс — уровень оценки. */
export const LEVELS = {
  cooper: ['poor', 'below_average', 'average', 'above_average', 'excellent'],
  cpafla: ['needs_improvement', 'fair', 'good', 'very_good', 'excellent'],
} as const

/**
 * Строка таблицы норм: возраст и нижние границы ступеней со второй по пятую. Пятая у
 * Купера — «больше», у CPAFLA — «не меньше»: так их пишут источники.
 */
interface Band {
  from: number
  to: number | null
  mins: readonly [number, number, number, number]
}

type Table = Record<Sex, readonly Band[]>

/**
 * Дистанция за 12 минут, м: Cooper K. H. A means of assessing maximal oxygen intake.
 * JAMA, 1968; таблица в том виде, как её приводит Topend Sports. С 20 лет у женщин —
 * следующая строка, а не 17–20, как в источнике: иначе 20 лет попадали бы в две.
 */
const COOPER: Table = {
  male: [
    { from: 13, to: 14, mins: [2100, 2200, 2400, 2700] },
    { from: 15, to: 16, mins: [2200, 2300, 2500, 2800] },
    { from: 17, to: 19, mins: [2300, 2500, 2700, 3000] },
    { from: 20, to: 29, mins: [1600, 2200, 2400, 2800] },
    { from: 30, to: 39, mins: [1500, 1900, 2300, 2700] },
    { from: 40, to: 49, mins: [1400, 1700, 2100, 2500] },
    { from: 50, to: null, mins: [1300, 1600, 2000, 2400] },
  ],
  female: [
    { from: 13, to: 14, mins: [1500, 1600, 1900, 2000] },
    { from: 15, to: 16, mins: [1600, 1700, 2000, 2100] },
    { from: 17, to: 19, mins: [1700, 1800, 2100, 2300] },
    { from: 20, to: 29, mins: [1500, 1800, 2200, 2700] },
    { from: 30, to: 39, mins: [1400, 1700, 2000, 2500] },
    { from: 40, to: 49, mins: [1200, 1500, 1900, 2300] },
    { from: 50, to: null, mins: [1100, 1400, 1700, 2200] },
  ],
}

/**
 * Отжимания до отказа: Canadian Physical Activity, Fitness & Lifestyle Approach (CSEP,
 * 3-е изд., 2003), их же приводит ACSM. У мужчин — классические, у женщин — с колен.
 */
const CPAFLA_PUSH_UPS: Table = {
  male: [
    { from: 15, to: 19, mins: [18, 23, 29, 39] },
    { from: 20, to: 29, mins: [17, 22, 29, 36] },
    { from: 30, to: 39, mins: [12, 17, 22, 30] },
    { from: 40, to: 49, mins: [10, 13, 17, 25] },
    { from: 50, to: 59, mins: [7, 10, 13, 21] },
    { from: 60, to: 69, mins: [5, 8, 11, 18] },
  ],
  female: [
    { from: 15, to: 19, mins: [12, 18, 25, 33] },
    { from: 20, to: 29, mins: [10, 15, 21, 30] },
    { from: 30, to: 39, mins: [8, 13, 20, 27] },
    { from: 40, to: 49, mins: [5, 11, 15, 24] },
    { from: 50, to: 59, mins: [2, 7, 11, 21] },
    { from: 60, to: 69, mins: [2, 5, 12, 17] },
  ],
}

/** Вариант отжиманий, для которого у пола есть нормы. */
const NORMED_VARIANT: Record<Sex, PushUpVariant> = { male: 'classic', female: 'knee' }

interface RatingBase {
  /** Номер ступени снизу, 0–4. */
  index: number
  sex: Sex
  /** Возраст строки таблицы; `to` пусто — «и старше». */
  ages: { from: number; to: number | null }
}

export type Rating =
  | (RatingBase & { scale: 'cooper'; level: (typeof LEVELS.cooper)[number] })
  | (RatingBase & { scale: 'cpafla'; level: (typeof LEVELS.cpafla)[number] })

/** Почему оценки нет: в профиле не хватает данных, нет норм для варианта, возраста или теста. */
export type NoRating = 'profile' | 'variant' | 'age' | 'none'

export type Rated = { rating: Rating } | { missing: NoRating }

type Result = Pick<
  Schemas['FitnessResultOut'],
  'test' | 'local_date' | 'reps' | 'distance_m' | 'variant'
>
type Profile = Pick<Schemas['UserOut'], 'sex' | 'birth_date'>

function band(table: Table, sex: Sex, age: number): Band | undefined {
  return table[sex].find((row) => age >= row.from && (row.to === null || age <= row.to))
}

/**
 * Оценка результата по полу и возрасту на день теста (ADR 0021). Её не хранят: таблица или
 * профиль поменяются — поменяется и оценка.
 */
export function rate(result: Result, profile: Profile): Rated {
  if (result.test === 'pull_ups') return { missing: 'none' }
  const { sex, birth_date: birthDate } = profile
  if (!sex || !birthDate) return { missing: 'profile' }
  if (result.test === 'push_ups' && result.variant !== NORMED_VARIANT[sex])
    return { missing: 'variant' }
  const cooper = result.test === 'cooper'
  const value = cooper ? result.distance_m : result.reps
  if (value === null) return { missing: 'none' }
  const row = band(cooper ? COOPER : CPAFLA_PUSH_UPS, sex, ageOn(birthDate, result.local_date))
  if (!row) return { missing: 'age' }
  const index = row.mins.filter((min, step) =>
    cooper && step === 3 ? value > min : value >= min,
  ).length
  const base = { index, sex, ages: { from: row.from, to: row.to } }
  return {
    rating: cooper
      ? { ...base, scale: 'cooper', level: LEVELS.cooper[index]! }
      : { ...base, scale: 'cpafla', level: LEVELS.cpafla[index]! },
  }
}

/** Главное число результата: VO2max у Купера, повторы у остальных. */
export function headline(result: Pick<Result, 'test' | 'reps' | 'distance_m'>): number {
  return result.test === 'cooper' ? vo2max(result.distance_m ?? 0) : (result.reps ?? 0)
}
