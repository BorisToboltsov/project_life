import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChoiceChip } from '@/components/form/ChoiceChip'
import { TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { parseDecimal } from '@/lib/numbers'
import { AMOUNT_MAX, AMOUNT_MIN, COUNT_MAX, COUNT_MIN } from '@/lib/portions'
import { uuidv7 } from '@/lib/uuid'
import { deferredBarcodes } from '@/offline/deferred'

type Mode = 'packages' | 'units'

const MODES: Mode[] = ['packages', 'units']

/** Число в границах меры и с её точностью: упаковки — до сотой, граммы — до десятой. */
function valid(mode: Mode, value: number | null): value is number {
  if (value === null) return false
  // Сравнение с допуском: 0,29 × 100 в дробях — 28,999…
  const exact = (scale: number) => Math.abs(Math.round(value * scale) - value * scale) < 1e-6
  return mode === 'packages'
    ? value >= COUNT_MIN && value <= COUNT_MAX && exact(100)
    : value >= AMOUNT_MIN && value <= AMOUNT_MAX && exact(10)
}

/**
 * Штрихкод на потом (ADR 0020): продукта нет на телефоне или Open Food Facts не отвечает.
 * Количество — упаковками или в граммах либо миллилитрах: единица и размер упаковки станут
 * известны вместе с продуктом.
 */
export function DeferForm({
  barcode,
  date,
  meal,
  onSaved,
}: {
  barcode: string
  date: string
  meal: string
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('packages')
  const [text, setText] = useState('1')
  const [invalid, setInvalid] = useState(false)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const value = parseDecimal(text)
    if (!valid(mode, value)) return setInvalid(true)
    await deferredBarcodes.add({
      id: uuidv7(),
      barcode,
      localDate: date,
      mealId: meal,
      amount: mode === 'packages' ? { packages: value } : { units: value },
    })
    await onSaved()
  }

  function choose(next: Mode) {
    setMode(next)
    setText(next === 'packages' ? '1' : '')
    setInvalid(false)
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{t('deferred.how')}</legend>
        <div className="flex flex-wrap gap-2">
          {MODES.map((value) => (
            <ChoiceChip
              key={value}
              name="deferred-mode"
              value={value}
              checked={mode === value}
              onChange={() => choose(value)}
            >
              {t(`deferred.${value}`)}
            </ChoiceChip>
          ))}
        </div>
      </fieldset>
      <TextField
        label={t(mode === 'packages' ? 'deferred.countLabel' : 'deferred.unitsLabel')}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        error={invalid ? t('deferred.invalid') : undefined}
        onChange={(event) => {
          setText(event.target.value)
          setInvalid(false)
        }}
      />
      <Button type="submit" className="h-11 justify-self-start">
        {t('deferred.save')}
      </Button>
    </form>
  )
}
