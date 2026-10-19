import { useTranslation } from 'react-i18next'
import { type LabValue, type Mark, markOf } from '@/lib/labs'
import { useLabNumber, useReferenceText } from './labText'

/** Отметка «вне референса» (инвариант I22): ↓ ниже, ↑ выше; в референсе — ничего. */
export function ReferenceMark({ mark }: { mark: Mark }) {
  const { t } = useTranslation()
  if (!mark) return null
  return (
    <span
      role="img"
      aria-label={t(mark === 'low' ? 'labs.low' : 'labs.high')}
      className="inline-block rounded bg-warning px-1.5 text-xs font-semibold text-warning-foreground"
    >
      {mark === 'low' ? '↓' : '↑'}
    </span>
  )
}

/** Вид строки-ссылки со значением. */
export const VALUE_ROW =
  'flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50'

/**
 * Содержимое строки значения: название и референс слева, число с единицей и отметкой
 * справа. Ссылку вокруг ставит экран — куда ведёт строка, решает он.
 */
export function ValueLine({
  value,
  name,
  unit,
  detail,
  pending,
}: {
  value: LabValue
  name: string
  unit: string
  detail?: string
  pending?: React.ReactNode
}) {
  const number = useLabNumber()
  const reference = useReferenceText()
  const mark = markOf(value)
  const secondary = [detail, reference(value.ref_low, value.ref_high)].filter(Boolean).join(' · ')
  return (
    <>
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium">{name}</span>
        {secondary && <span className="text-sm text-muted-foreground">{secondary}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-right">
        <span className={mark ? 'font-medium text-warning-foreground' : 'font-medium'}>
          {number(value.original_value)}
          {'\u00a0'}
          <span className="text-sm font-normal text-muted-foreground">{unit}</span>
        </span>
        <ReferenceMark mark={mark} />
        {pending}
      </span>
    </>
  )
}
