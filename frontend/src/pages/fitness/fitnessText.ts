import { useTranslation } from 'react-i18next'

import type { FitnessResult } from '@/api/fitness'
import { FITNESS_TESTS, type FitnessTest, type Rating, vo2max } from '@/lib/fitness'
import { intlLocale } from '@/lib/locale'
import { formatNumber } from '@/lib/numbers'

/** Формы слова при числе, которые различают словари. */
const FORMS = ['one', 'few', 'many'] as const

/** Код теста из адреса; незнакомый — `undefined`. */
export function testOf(value: string): FitnessTest | undefined {
  return FITNESS_TESTS.find((test) => test === value)
}

/** Число повторов словами языка интерфейса: «38 раз», «2 раза», «1 rep». */
export function useRepsText(): (count: number) => string {
  const { t, i18n } = useTranslation()
  return (count) => {
    const rule = new Intl.PluralRules(intlLocale(i18n.language)).select(count)
    const form = FORMS.find((item) => item === rule) ?? 'other'
    return t(`repCounts.${form}`, { number: formatNumber(count, i18n.language, 0) })
  }
}

type Raw = Pick<FitnessResult, 'test' | 'reps'> & {
  distance: { value: number; unit: 'm' | 'mi' } | null
}

/** Что человек сделал, как он это ввёл: «2 650 м», «1,65 миль», «38 раз». */
export function useRawText(): (result: Raw) => string {
  const { t, i18n } = useTranslation()
  const reps = useRepsText()
  return ({ test, reps: count, distance }) => {
    if (test === 'cooper' && distance) {
      const digits = distance.unit === 'mi' ? 2 : 0
      return `${formatNumber(distance.value, i18n.language, digits)} ${t(`unitNames.${distance.unit}`)}`
    }
    return reps(count ?? 0)
  }
}

/** Сырой результат из ответа сервера — в форме, которую понимает `useRawText`. */
export function rawOf(result: FitnessResult): Raw {
  return {
    test: result.test,
    reps: result.reps,
    distance:
      result.distance_value !== null && result.distance_unit
        ? { value: result.distance_value, unit: result.distance_unit }
        : null,
  }
}

/** VO2max с одним знаком после запятой. */
export function useVo2maxText(): (distanceM: number) => string {
  const { i18n } = useTranslation()
  return (distanceM) => formatNumber(vo2max(distanceM), i18n.language, 1)
}

/** Главное число строки: «VO2max 47,1» у Купера, «38 раз» у остальных. */
export function useHeadlineText(): (result: FitnessResult) => string {
  const vo2 = useVo2maxText()
  const reps = useRepsText()
  return (result) =>
    result.test === 'cooper' ? `VO2max ${vo2(result.distance_m ?? 0)}` : reps(result.reps ?? 0)
}

/** Ступень оценки словами и по какой таблице она подобрана. */
export function useRatingText(): (rating: Rating) => { level: string; source: string } {
  const { t } = useTranslation()
  return (rating) => {
    const ages =
      rating.ages.to === null
        ? t('fitness.agesFrom', { from: rating.ages.from })
        : t('fitness.ages', { from: rating.ages.from, to: rating.ages.to })
    const group = t(`fitness.groups.${rating.sex}`, { ages })
    const level =
      rating.scale === 'cooper'
        ? t(`fitnessLevels.cooper.${rating.level}`)
        : t(`fitnessLevels.cpafla.${rating.level}`)
    return { level, source: t(`fitness.rated.${rating.scale}`, { group }) }
  }
}
