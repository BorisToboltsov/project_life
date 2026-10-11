import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { type Product, PRODUCTS_KEY, saveProduct } from '@/api/nutrition'
import { FormError, TextField } from '@/components/form/fields'
import { numberOf } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'

import { productDefaults, productSchema, type ProductValues } from './productValues'

/**
 * Форма продукта каталога: название и состав на 100 г. Без `product` создаёт новый.
 * `onSaved` получает ключ сохранённого продукта, `cancel` — ссылка «Отмена».
 */
export function ProductForm({
  product,
  onSaved,
  cancel,
}: {
  product?: Product
  onSaved: (id: string) => void | Promise<void>
  cancel: ReactNode
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ нового продукта живёт, пока открыта форма: повторная отправка не создаст дубль.
  const id = useRef(product?.id ?? uuidv7())
  const form = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: productDefaults(product),
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: ProductValues) {
    setFailure(undefined)
    const result = await saveProduct(id.current, {
      name: values.name.trim(),
      kcal: numberOf(values.kcal, 1),
      protein_g: numberOf(values.protein, 2),
      fat_g: numberOf(values.fat, 2),
      carbs_g: numberOf(values.carbs, 2),
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    await onSaved(id.current)
  }

  const number = { inputMode: 'decimal', autoComplete: 'off' } as const

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
      <p className="text-sm text-muted-foreground">{t('products.per100Hint')}</p>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('products.kcal')}
          error={errors.kcal?.message}
          {...number}
          {...form.register('kcal')}
        />
        <TextField
          label={t('products.protein')}
          error={errors.protein?.message}
          {...number}
          {...form.register('protein')}
        />
        <TextField
          label={t('products.fat')}
          error={errors.fat?.message}
          {...number}
          {...form.register('fat')}
        />
        <TextField
          label={t('products.carbs')}
          error={errors.carbs?.message}
          {...number}
          {...form.register('carbs')}
        />
      </div>
      <div className="flex gap-3">
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {t('common.save')}
        </Button>
        {cancel}
      </div>
    </form>
  )
}
