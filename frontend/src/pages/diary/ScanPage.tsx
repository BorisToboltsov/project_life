import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  type BarcodeLookup,
  lookupBarcode,
  type ProductDraft,
  productKey,
  PRODUCTS_KEY,
} from '@/api/nutrition'
import { FormError, TextField } from '@/components/form/fields'
import { BarcodeScanner } from '@/components/scanner/BarcodeScanner'
import { Button } from '@/components/ui/button'
import { normalizeBarcode } from '@/lib/barcode'
import type { ErrorKey } from '@/lib/errors'
import { ProductForm } from '@/pages/products/ProductForm'

import { barcodeSchema, type BarcodeValues } from './values'

/** Продукта в каталоге нет: чем кончился поиск и что о продукте известно. */
interface Missing {
  status: Exclude<BarcodeLookup['status'], 'found'>
  barcode: string
  draft?: ProductDraft | null
}

type Step =
  | { at: 'scan' }
  | { at: 'lookup'; barcode: string }
  | { at: 'failed'; barcode: string; failure: ErrorKey }
  | { at: 'create'; missing: Missing }

/** Штрихкод цифрами — для стёртой упаковки и для устройства без камеры. */
function ManualEntry({ onEntered }: { onEntered: (barcode: string) => void }) {
  const { t } = useTranslation()
  const form = useForm<BarcodeValues>({
    resolver: zodResolver(barcodeSchema),
    defaultValues: { barcode: '' },
  })

  function submit(values: BarcodeValues) {
    const barcode = normalizeBarcode(values.barcode)
    if (barcode) onEntered(barcode)
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-3"
    >
      <TextField
        label={t('scan.manual')}
        inputMode="numeric"
        autoComplete="off"
        hint={t('scan.manualHint')}
        error={form.formState.errors.barcode?.message}
        {...form.register('barcode')}
      />
      <Button type="submit" variant="outline" className="h-11 justify-self-start">
        {t('scan.find')}
      </Button>
    </form>
  )
}

const route = getRouteApi('/app/diary/$date/add/$meal/scan')

/**
 * Продукт по штрихкоду по пути в приём пищи (ADR 0009): камера или цифры → поиск. Найденный
 * продукт возвращает к вводу количества; для ненайденного открывается форма создания с
 * подставленным штрихкодом и тем, что о продукте известно.
 */
export function ScanPage() {
  const { t } = useTranslation()
  const { date, meal } = route.useParams() as { date: string; meal: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>({ at: 'scan' })
  // Экран могли закрыть, пока шёл поиск: его ответ тогда уже никуда не ведёт.
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])

  const toMeal = { to: '/diary/$date/add/$meal', params: { date, meal } } as const

  async function find(barcode: string) {
    setStep({ at: 'lookup', barcode })
    const result = await lookupBarcode(barcode)
    if (!shown.current) return
    if (result.failure) {
      setStep({ at: 'failed', barcode, failure: result.failure })
      return
    }
    const { status, product, draft } = result.data
    if (status !== 'found' || !product) {
      setStep({
        at: 'create',
        missing: { status: status === 'found' ? 'not_found' : status, barcode, draft },
      })
      return
    }
    queryClient.setQueryData(productKey(product.id), product)
    // Продукт мог появиться в каталоге только что — из Open Food Facts.
    void queryClient.invalidateQueries({ queryKey: [...PRODUCTS_KEY, 'search'] })
    // Сканер в истории не остаётся: «назад» из приёма пищи не включит камеру снова.
    await navigate({ ...toMeal, search: { scanned: product.id }, replace: true })
  }

  const again = (
    <Button variant="outline" className="h-11" onClick={() => setStep({ at: 'scan' })}>
      {t('scan.again')}
    </Button>
  )

  if (step.at === 'create') {
    const { status, barcode, draft } = step.missing
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('products.newTitle')}</h1>
        <p role="status" className="text-sm text-muted-foreground">
          {t(`lookupNotices.${status}`, { barcode })}
        </p>
        <ProductForm
          draft={{ ...draft, barcode }}
          onSaved={(product) => navigate({ ...toMeal, search: { product }, replace: true })}
          cancel={
            <Button asChild variant="ghost" className="h-11">
              <Link {...toMeal}>{t('products.cancel')}</Link>
            </Button>
          }
        />
        <div>{again}</div>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('scan.title')}</h1>
      {step.at === 'scan' && (
        <>
          <BarcodeScanner onDetected={(barcode) => void find(barcode)} />
          <ManualEntry onEntered={(barcode) => void find(barcode)} />
        </>
      )}
      {step.at === 'lookup' && (
        <p role="status" className="text-muted-foreground">
          {t('scan.looking', { barcode: step.barcode })}
        </p>
      )}
      {step.at === 'failed' && (
        <>
          <FormError failure={step.failure} />
          <div className="flex flex-wrap gap-3">
            <Button className="h-11" onClick={() => void find(step.barcode)}>
              {t('common.retry')}
            </Button>
            {again}
          </div>
        </>
      )}
      <div>
        <Button asChild variant="ghost" className="h-11">
          <Link {...toMeal}>{t('scan.back')}</Link>
        </Button>
      </div>
    </div>
  )
}
