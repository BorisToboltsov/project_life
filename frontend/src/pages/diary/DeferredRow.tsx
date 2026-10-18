import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ScanBarcode } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DIARY_KEY, saveEntry, useProduct } from '@/api/nutrition'
import { FormError } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'
import { formatKcal } from '@/lib/nutrition'
import { portionsAmount } from '@/lib/portions'
import type { Deferred } from '@/offline/db'
import { deferredBarcodes, entryBodyOf } from '@/offline/deferred'
import { eatenOf } from '@/offline/diary'

import { useDeferredAmount } from './deferredAmount'
import { useQuantityText } from './quantityText'

/**
 * Запись по штрихкоду в приёме пищи (ADR 0020): пунктирная строка, пока продукт ищется, и
 * предложение, когда он найден, — в дневник он попадает только после «Внести».
 */
export function DeferredRow({ item }: { item: Deferred }) {
  const { t } = useTranslation()
  const amountText = useDeferredAmount()
  if (item.status === 'found' && item.productId) return <Offer item={item} />
  return (
    <li className="flex items-center gap-3 rounded-lg border border-dashed border-foreground/30 p-3">
      <ScanBarcode className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium break-all">{item.barcode}</p>
        <p className="text-sm text-muted-foreground">
          {amountText(item)} · {t('deferred.waiting')}
        </p>
      </div>
    </li>
  )
}

function Offer({ item }: { item: Deferred }) {
  const { t, i18n } = useTranslation()
  const quantityText = useQuantityText()
  const amountText = useDeferredAmount()
  const queryClient = useQueryClient()
  const product = useProduct(item.productId).data ?? undefined
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()
  const body = product ? entryBodyOf(item, product) : undefined
  const amount = body
    ? body.portion
      ? portionsAmount(Number(body.portion.count), product?.package_size ?? 0)
      : Number(body.amount)
    : undefined
  const portion = body?.portion
    ? { kind: body.portion.kind, count: Number(body.portion.count) }
    : null
  const change = (
    <Link
      to="/diary/$date/add/$meal"
      params={{ date: item.localDate, meal: item.mealId }}
      search={{ scanned: item.productId, deferred: item.id }}
    >
      {body ? t('deferred.change') : t('deferred.setAmount')}
    </Link>
  )

  async function enter() {
    if (!body) return
    setBusy(true)
    setFailure(undefined)
    // Ключ отложенной записи становится ключом записи дневника: повтор не создаст вторую.
    const result = await saveEntry(item.id, body)
    setBusy(false)
    if (result.failure) return setFailure(result.failure)
    await deferredBarcodes.remove(item.id)
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
  }

  return (
    <li
      className="grid gap-2 rounded-lg border border-dashed border-primary bg-muted/50 p-3"
      aria-label={t('deferred.found')}
    >
      <p className="text-xs text-muted-foreground">{t('deferred.found')}</p>
      <p className="font-medium break-words">{product?.name ?? item.barcode}</p>
      <p className="text-sm text-muted-foreground">
        {product && body && amount !== undefined
          ? `${quantityText({
              amount,
              unit: product.unit,
              portion,
            })} · ${t('diary.kcal', { value: formatKcal(eatenOf(product, amount).kcal, i18n.language) })}`
          : `${amountText(item)} · ${t('deferred.noPackage')}`}
      </p>
      {asking ? (
        <div className="flex flex-wrap gap-2">
          {product?.editable && (
            <Button asChild variant="outline" className="h-11">
              <Link to="/diary/$date/barcode/$id" params={{ date: item.localDate, id: item.id }}>
                {t('deferred.fix')}
              </Link>
            </Button>
          )}
          <Button
            variant="destructive"
            className="h-11"
            onClick={() => void deferredBarcodes.remove(item.id)}
          >
            {t('deferred.drop')}
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setAsking(false)}>
            {t('deferred.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {body && (
            <Button className="h-11" disabled={busy} onClick={() => void enter()}>
              {t('deferred.enter')}
            </Button>
          )}
          <Button asChild variant="outline" className="h-11">
            {change}
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setAsking(true)}>
            {t('deferred.wrong')}
          </Button>
        </div>
      )}
      <FormError failure={failure} />
    </li>
  )
}
