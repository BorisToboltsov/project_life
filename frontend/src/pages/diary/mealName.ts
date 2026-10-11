import { useTranslation } from 'react-i18next'

import type { Meal } from '@/api/nutrition'

/**
 * Название приёма пищи: своего — как его назвал пользователь, предустановленного — на
 * языке интерфейса.
 */
export function useMealName(): (meal: Pick<Meal, 'preset' | 'name'>) => string {
  const { t } = useTranslation()
  return (meal) => meal.name ?? (meal.preset ? t(`meals.${meal.preset}`) : '')
}
