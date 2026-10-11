import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type Product, PRODUCT_UNITS, PRODUCTS_KEY, saveProduct } from '@/api/nutrition'
import { FormError, SelectField, TextField } from '@/components/form/fields'
import { useAutoKcal } from '@/components/form/useAutoKcal'
import { numberOf } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import { normalizeBarcode } from '@/lib/barcode'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'

import {
  productDefaults,
  productSchema,
  type ProductSeed,
  type ProductValues,
} from './productValues'

/** Калории продукта хранятся с точностью до десятой. */
const KCAL_DIGITS = 1

/**
 * Форма продукта каталога: название, единица, состав на 100 таких единиц и штрихкод. Без
 * `product` создаёт новый; `draft` — что о новом уже известно по штрихкоду. Калории
 * считаются по белкам, жирам и углеводам, пока их не ввели сами: на упаковке число бывает
 * другим. `onSaved` получает ключ сохранённого продукта, `cancel` — ссылка «Отмена».
 */
export function ProductForm({
  product,
  draft,
  onSaved,
  cancel,
}: {
  product?: Product
  draft?: ProductSeed
  onSaved: (id: string) => void | Promise<void>
  cancel: ReactNode
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ нового продукта живёт, пока открыта форма: повторная отправка не создаст дубль.
  const id = useRef(product?.id ?? uuidv7())
  const defaults = productDefaults(product ?? draft)
  const form = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: defaults,
  })
  const { errors, isSubmitting, isSubmitted } = form.formState
  const unit = useWatch({ control: form.control, name: 'unit' })
  const auto = useAutoKcal({
    initial: defaults,
    digits: KCAL_DIGITS,
    read: form.getValues,
    // После первой отправки поле перепроверяется: его ошибка не должна пережить расчёт.
    write: (kcal) => form.setValue('kcal', kcal, { shouldValidate: isSubmitted }),
  })

  async function submit(values: ProductValues) {
    setFailure(undefined)
    const result = await saveProduct(id.current, {
      name: values.name.trim(),
      unit: values.unit,
      kcal: numberOf(values.kcal, KCAL_DIGITS),
      protein_g: numberOf(values.protein, 2),
      fat_g: numberOf(values.fat, 2),
      carbs_g: numberOf(values.carbs, 2),
      barcode: normalizeBarcode(values.barcode),
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    await onSaved(id.current)
  }

  const number = { inputMode: 'decimal', autoComplete: 'off' } as const
  const macro = { onChange: auto.follow }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-4"
    >
      <FormError failure={failure} />
      <TextField
        label={t('products.name')}
        autoComplete="off"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <SelectField label={t('products.unit')} {...form.register('unit')}>
        {PRODUCT_UNITS.map((option) => (
          <option key={option} value={option}>
            {t(`productUnitNames.${option}`)}
          </option>
        ))}
      </SelectField>
      <p className="text-sm text-muted-foreground">
        {t('products.per100Hint', { unit: t(`productUnits.${unit}`) })}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('products.kcal')}
          error={errors.kcal?.message}
          {...number}
          {...form.register('kcal', auto.kcal)}
        />
        <TextField
          label={t('products.protein')}
          error={errors.protein?.message}
          {...number}
          {...form.register('protein', macro)}
        />
        <TextField
          label={t('products.fat')}
          error={errors.fat?.message}
          {...number}
          {...form.register('fat', macro)}
        />
        <TextField
          label={t('products.carbs')}
          error={errors.carbs?.message}
          {...number}
          {...form.register('carbs', macro)}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t('products.kcalHint')}</p>
      <TextField
        label={t('products.barcode')}
        inputMode="numeric"
        autoComplete="off"
        hint={t('products.barcodeHint')}
        error={errors.barcode?.message}
        {...form.register('barcode')}
      />
      <div className="flex gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
        {cancel}
      </div>
    </form>
  )
}
