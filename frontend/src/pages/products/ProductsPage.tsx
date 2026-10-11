import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProductSearch } from '@/api/nutrition'
import { TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'

import { ProductLine } from './ProductLine'

export function ProductsPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const q = query.trim()
  const products = useProductSearch(q)

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('products.title')}</h1>
      <Button asChild className="h-11 justify-self-start">
        <Link to="/products/new">{t('products.create')}</Link>
      </Button>
      <TextField
        label={t('products.search')}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
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
    </div>
  )
}
