import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deleteProduct, type Product, PRODUCTS_KEY, useProduct } from '@/api/nutrition'
import { FormError } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import type { ErrorKey } from '@/lib/errors'
import { formatNumber } from '@/lib/numbers'

import { ProductForm } from './ProductForm'
import { ProductLine } from './ProductLine'

function BackToCatalog({ label }: { label: string }) {
  return (
    <Button asChild variant="ghost" className="h-11">
      <Link to="/products">{label}</Link>
    </Button>
  )
}

export function ProductNewPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('products.newTitle')}</h1>
      <ProductForm
        onSaved={() => navigate({ to: '/products' })}
        cancel={<BackToCatalog label={t('products.cancel')} />}
      />
    </div>
  )
}

/**
 * Откуда состав продукта, взятого из Open Food Facts: его вносят добровольцы, а лицензия
 * базы просит называть источник (ADR 0009).
 */
function ProductSource({ product }: { product: Product }) {
  const { t } = useTranslation()
  if (product.source !== 'open_food_facts') return null
  return (
    <p className="text-sm text-muted-foreground">
      {t('products.fromOpenFoodFacts')}{' '}
      {product.barcode && (
        <a
          className="underline underline-offset-4"
          href={`https://world.openfoodfacts.org/product/${product.barcode}`}
          target="_blank"
          rel="noreferrer"
        >
          {t('products.openFoodFactsLink')}
        </a>
      )}
    </p>
  )
}

const LABEL_NUTRIENTS = ['saturated_fat_g', 'sugars_g', 'fiber_g', 'salt_g'] as const

/** Что ещё известно с этикетки — те значения, что внесены; хранятся до сотой грамма. */
function ProductLabel({ product }: { product: Product }) {
  const { t, i18n } = useTranslation()
  const known = LABEL_NUTRIENTS.filter((name) => product[name] != null)
  if (known.length === 0) return null
  return (
    <ul aria-label={t('products.labelTitle')} className="mt-2 text-sm text-muted-foreground">
      {known.map((name) => (
        <li key={name}>
          {t(`labelNutrients.${name}`, {
            value: formatNumber(product[name] ?? 0, i18n.language, 2),
          })}
        </li>
      ))}
    </ul>
  )
}

function DeleteProduct({ product }: { product: Product }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ErrorKey>()

  async function remove() {
    const result = await deleteProduct(product.id)
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
    await navigate({ to: '/products' })
  }

  return (
    <div className="grid gap-2 border-t pt-4">
      <FormError failure={failure} />
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t('products.deleteConfirm')}</span>
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            {t('products.deleteYes')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            {t('products.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-11 justify-self-start"
          onClick={() => setConfirming(true)}
        >
          {t('products.delete')}
        </Button>
      )}
    </div>
  )
}

const editRoute = getRouteApi('/app/products/$id')

export function ProductEditPage() {
  const { t } = useTranslation()
  const { id } = editRoute.useParams() as { id: string }
  const navigate = useNavigate()
  const product = useProduct(id)

  if (product.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  if (!product.data) {
    return (
      <div className="grid gap-4">
        <p>{t('products.notFound')}</p>
        <Button asChild variant="outline" className="h-11 justify-self-start">
          <Link to="/products">{t('products.back')}</Link>
        </Button>
      </div>
    )
  }
  if (!product.data.editable) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t('products.title')}</h1>
        <div className="rounded-lg border p-3">
          <ProductLine product={product.data} />
          <ProductLabel product={product.data} />
        </div>
        <ProductSource product={product.data} />
        <p className="text-sm text-muted-foreground">{t('products.readOnly')}</p>
        <Button asChild variant="outline" className="h-11 justify-self-start">
          <Link to="/products">{t('products.back')}</Link>
        </Button>
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('products.editTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('products.pastDays')}</p>
      <ProductSource product={product.data} />
      <ProductForm
        product={product.data}
        onSaved={() => navigate({ to: '/products' })}
        cancel={<BackToCatalog label={t('products.cancel')} />}
      />
      <DeleteProduct product={product.data} />
    </div>
  )
}
