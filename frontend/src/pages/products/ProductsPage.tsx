import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProductSearch } from '@/api/nutrition'
import { TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'

import { DishForm } from './DishForm'

import { ExternalSearch } from './ExternalSearch'
import type { Missing } from './lookup'
import { MissingProduct } from './MissingProduct'
import { ProductLine } from './ProductLine'

const kinds = ['all', 'products', 'dishes'] as const

export function ProductsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [dish, setDish] = useState(false)
  const [kind, setKind] = useState<'all' | 'products' | 'dishes'>('all')
  const [query, setQuery] = useState('')
  // Продукт из Open Food Facts, состав которого нужно дополнить: вместо каталога — форма.
  const [missing, setMissing] = useState<Missing>()
  const q = query.trim()
  const products = useProductSearch(q, true, kind)

  if (dish) return <DishForm onSaved={() => setDish(false)} onCancel={() => setDish(false)} />

  if (missing) {
    return (
      <MissingProduct
        missing={missing}
        onSaved={() => setMissing(undefined)}
        cancel={
          <Button variant="ghost" className="h-11" onClick={() => setMissing(undefined)}>
            {t('products.cancel')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('products.title')}</h1>
      <Button asChild className="h-11 justify-self-start">
        <Link to="/products/new">{t('products.create')}</Link>
      </Button>
      <Button variant="outline" onClick={() => setDish(true)}>
        {t('dishes.create')}
      </Button>
      <div className="flex gap-2">
        {kinds.map((value) => (
          <Button
            key={value}
            variant={kind === value ? 'default' : 'outline'}
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {t(`dishes.${value}`)}
          </Button>
        ))}
      </div>
      <TextField
        label={t('products.search')}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <section className="grid gap-2">
        {/* При поиске каталог — одна из двух секций: вторая — Open Food Facts. */}
        {q && products.data && products.data.length > 0 && (
          <h2 className="text-sm font-medium text-muted-foreground">{t('search.inCatalog')}</h2>
        )}
        {products.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {q ? t('addFood.nothingFound') : t('products.empty')}
          </p>
        )}
        <ul aria-label={t('products.title')} className="grid gap-2">
          {products.data?.map((product) => (
            <li key={product.id}>
              <Link
                to="/products/$id"
                params={{ id: product.id }}
                className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <ProductLine product={product} />
              </Link>
            </li>
          ))}
        </ul>
        {products.hasNextPage && (
          <Button
            variant="outline"
            className="h-11 justify-self-start"
            disabled={products.isFetchingNextPage}
            onClick={() => void products.fetchNextPage()}
          >
            {t('search.more')}
          </Button>
        )}
      </section>
      <ExternalSearch
        q={q}
        onFound={(product) => navigate({ to: '/products/$id', params: { id: product.id } })}
        onMissing={setMissing}
      />
    </div>
  )
}
