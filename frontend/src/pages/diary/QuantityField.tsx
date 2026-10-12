import { useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import type { ProductUnit } from '@/api/nutrition'
import { ChoiceChip } from '@/components/form/ChoiceChip'
import { TextField } from '@/components/form/fields'
import { formatGrams, formatKcal } from '@/lib/nutrition'
import { AMOUNT_MODES, type AmountMode, type PortionSizes } from '@/lib/portions'

import { type Quantity, switched, unitsOf } from './quantity'

/**
 * Количество продукта: в его единицах, порциями или упаковками (ADR 0013). Меры — ряд
 * меток над полем; под полем — сколько это в единицах продукта и в калориях. У продукта
 * без порции и упаковки меток нет. Живёт внутри формы с полями `mode` и `amount`
 * (`FormProvider`).
 */
export function QuantityField({
  unit,
  sizes,
  kcal,
}: {
  unit: ProductUnit
  sizes: PortionSizes
  /** Калорий в 100 единицах продукта — для строки пересчёта. */
  kcal: number
}) {
  const { t, i18n } = useTranslation()
  const { register, setValue, getValues, control, formState } = useFormContext<Quantity>()
  const mode = useWatch({ control, name: 'mode' })
  const amount = useWatch({ control, name: 'amount' })
  // Набирали ли число с последней смены меры: набранное смена меры не подменяет.
  const [typed, setTyped] = useState(false)
  const modes = AMOUNT_MODES.filter((item) => item === 'unit' || sizes[item] !== undefined)
  const unitName = t(`productUnits.${unit}`)
  const inUnits = (value: number) =>
    t('quantity.units', { amount: formatGrams(value, i18n.language), unit: unitName })
  const units = unitsOf({ mode, amount }, sizes)

  function choose(to: AmountMode) {
    // `mode` здесь — мера до смены: форма уже знает новую, экран ещё нет.
    const next = switched({ mode, amount: getValues('amount') }, to, sizes, typed)
    setTyped(false)
    // После первой отправки поле перепроверяется: его ошибка не должна пережить смену меры.
    setValue('amount', next, { shouldValidate: formState.isSubmitted })
  }

  return (
    <div className="grid gap-3">
      {modes.length > 1 && (
        <fieldset>
          <legend className="sr-only">{t('quantity.legend')}</legend>
          <div className="flex flex-wrap gap-2">
            {modes.map((item) => (
              <ChoiceChip
                key={item}
                value={item}
                {...register('mode', {
                  onChange: (event: { target: { value: AmountMode } }) =>
                    choose(event.target.value),
                })}
              >
                {item === 'unit'
                  ? unitName
                  : t(`quantity.modes.${item}`, {
                      size: formatGrams(sizes[item] ?? 0, i18n.language),
                      unit: unitName,
                    })}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      )}
      <TextField
        label={
          mode === 'unit'
            ? t('quantity.howMany.unit', { unit: unitName })
            : t(`quantity.howMany.${mode}`)
        }
        inputMode="decimal"
        autoComplete="off"
        error={formState.errors.amount?.message}
        {...register('amount', { onChange: () => setTyped(true) })}
      />
      {mode !== 'unit' && units !== null && (
        <p className="text-sm text-muted-foreground">
          {t('quantity.equals', {
            units: inUnits(units),
            kcal: formatKcal((kcal * units) / 100, i18n.language),
          })}
        </p>
      )}
    </div>
  )
}
