import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { DIARY_KEY, saveEntry, useProduct } from '@/api/nutrition'
import { Button } from '@/components/ui/button'
import { deferredBarcodes, entryBodyOf } from '@/offline/deferred'
import { productFromCopy } from '@/offline/diary'
import { useOfflineState } from '@/offline/store'
import { MissingProduct } from '@/pages/products/MissingProduct'
import { ProductForm } from '@/pages/products/ProductForm'

const route = getRouteApi('/app/diary/$date/barcode/$id')

/**
 * Продукт отложенной записи по штрихкоду (ADR 0020). Найденный, но «не тот» — правится, и
 * запись снова ждёт согласия. Ненайденный — заполняется с упаковки и сразу вносится с
 * отложенным количеством: его только что проверил сам человек.
 */
export function BarcodePage() {
  const { t } = useTranslation()
  const { date, id } = route.useParams() as { date: string; id: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const item = useOfflineState().deferred.find((value) => value.id === id)
  const product = useProduct(item?.status === 'found' ? item.productId : undefined)
  const toDay = () => navigate({ to: '/diary/$date', params: { date } })
  const back = (
    <Button asChild variant="ghost" className="h-11">
      <Link to="/diary/$date" params={{ date }}>
        {t('deferred.cancel')}
      </Link>
    </Button>
  )

  async function filled(productId: string) {
    if (!item) return
    const saved = await productFromCopy(productId)
    const body = saved && entryBodyOf(item, saved)
    if (!body) {
      // Размер упаковки неизвестен — количество человек укажет сам.
      await navigate({
        to: '/diary/$date/add/$meal',
        params: { date, meal: item.mealId },
        search: { scanned: productId, deferred: item.id },
      })
      return
    }
    const result = await saveEntry(item.id, body)
    if (!result.failure) await deferredBarcodes.remove(item.id)
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    await toDay()
  }

  if (!item) return <p className="text-muted-foreground">{t('common.loading')}</p>
  if (item.status === 'missing' && item.missing)
    return (
      <MissingProduct
        missing={{ status: item.missing.status, barcode: item.barcode, draft: item.missing.draft }}
        onSaved={filled}
        cancel={back}
      />
    )
  if (!product.data) return <p className="text-muted-foreground">{t('common.loading')}</p>
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('deferred.fix')}</h1>
      <ProductForm product={product.data} onSaved={() => void toDay()} cancel={back} />
    </div>
  )
}
