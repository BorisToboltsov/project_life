import { useTranslation } from 'react-i18next'

import { ProgressBar } from '@/components/ProgressBar'
import { formatGrams, formatKcal, share } from '@/lib/nutrition'

/** «Съедено из цели» одной строкой и шкалой; без цели — только съеденное. */
export function Measure({
  label,
  unit,
  eaten,
  goal,
  prominent = false,
}: {
  label: string
  unit: 'kcal' | 'grams'
  eaten: number
  goal: number | undefined
  /** Крупно — для калорий, главного числа дня. */
  prominent?: boolean
}) {
  const { t, i18n } = useTranslation()
  const format = unit === 'kcal' ? formatKcal : formatGrams
  const value = format(eaten, i18n.language)

  return (
    <div className="grid gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={prominent ? 'text-xl font-semibold' : 'text-sm font-medium'}>
        {goal === undefined
          ? t(`diary.${unit}`, { value })
          : t(`diary.${unit}Of`, { value, goal: format(goal, i18n.language) })}
      </span>
      {goal !== undefined && (
        <ProgressBar label={label} value={share(eaten, goal)} over={eaten > goal} />
      )}
    </div>
  )
}
