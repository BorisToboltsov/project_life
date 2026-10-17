import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type Schemas } from '@/api/client'
import { type Product, PRODUCTS_KEY, saveProduct, useProductSearch } from '@/api/nutrition'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { type ErrorKey } from '@/lib/errors'
import { uuidv7 } from '@/lib/uuid'

import { ExternalSearch } from './ExternalSearch'
import type { Missing } from './lookup'
import { MissingProduct } from './MissingProduct'
import { ProductForm } from './ProductForm'

type Row = {
  key: string
  id: string
  snapshot: Schemas['ProductIn-Output'] | Product
  amount: string
  mass: string
  removed: boolean
}
const num = (value: string) => Number(value.replace(',', '.'))

export function DishForm(props: {
  product?: Product
  onSaved: (id: string) => void | Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const loaded = useQuery({
    queryKey: [...PRODUCTS_KEY, 'recipe-current', props.product?.id, props.product?.editable],
    queryFn: async () =>
      Promise.all(
        (props.product?.recipe?.ingredients ?? []).map(async (item) => {
          const result = await api.GET('/api/products/{product_id}', {
            params: { path: { product_id: item.product_id } },
          })
          if (!result.data && result.response.status !== 404)
            throw new Error('Recipe ingredient unavailable')
          return {
            key: uuidv7(),
            id: item.product_id,
            snapshot: props.product?.editable ? (result.data ?? item.snapshot) : item.snapshot,
            amount: String(item.amount),
            mass: String(item.mass_g ?? ''),
            removed: !result.data,
          }
        }),
      ),
    retry: false,
  })
  if (loaded.isError)
    return (
      <div>
        <p>{t('errors.network')}</p>
        <Button onClick={() => void loaded.refetch()}>{t('common.retry')}</Button>
      </div>
    )
  if (!loaded.data) return <p>{t('common.loading')}</p>
  return <Editor {...props} initial={loaded.data} />
}

function Editor({
  product,
  initial,
  onSaved,
  onCancel,
}: {
  product?: Product
  initial: Row[]
  onSaved: (id: string) => void | Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const cache = useQueryClient()
  const [id] = useState(() => product?.id ?? uuidv7())
  const [name, setName] = useState(product?.name ?? '')
  const [rows, setRows] = useState(initial)
  const [output, setOutput] = useState(product?.recipe ? String(product.recipe.output_g) : '')
  const [serving, setServing] = useState(String(product?.serving_size ?? ''))
  const [search, setSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [create, setCreate] = useState(false)
  const [missing, setMissing] = useState<Missing>()
  const [failure, setFailure] = useState<ErrorKey>()
  const [busy, setBusy] = useState(false)
  const found = useProductSearch(query, search)
  const editable = product?.editable ?? true
  const weight =
    output === ''
      ? rows.reduce((sum, r) => sum + num(r.snapshot.unit === 'ml' ? r.mass : r.amount), 0)
      : num(output)
  const total = (field: 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g') =>
    weight > 0
      ? (
          rows.reduce((sum, r) => sum + Number(r.snapshot[field]) * num(r.amount), 0) / weight
        ).toFixed(1)
      : '—'
  function add(p: Product) {
    setRows([
      ...rows,
      { key: uuidv7(), id: p.id, snapshot: p, amount: '100', mass: '', removed: false },
    ])
    setSearch(false)
    setQuery('')
  }
  async function created(identity: string) {
    const result = await api.GET('/api/products/{product_id}', {
      params: { path: { product_id: identity } },
    })
    if (!result.data) {
      setFailure('errors.product_not_found')
      return
    }
    add(result.data)
    setCreate(false)
    setMissing(undefined)
  }
  function update(key: string, field: 'amount' | 'mass', value: string) {
    setRows(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)))
  }
  async function save() {
    if (
      !name.trim() ||
      !rows.length ||
      !Number.isFinite(weight) ||
      weight <= 0 ||
      weight > 5000 ||
      rows.some(
        (r) =>
          !Number.isFinite(num(r.amount)) ||
          num(r.amount) <= 0 ||
          (r.snapshot.unit === 'ml' && (!Number.isFinite(num(r.mass)) || num(r.mass) <= 0)),
      )
    ) {
      setFailure('errors.invalid_recipe')
      return
    }
    setBusy(true)
    setFailure(undefined)
    const result = await saveProduct(id, {
      name,
      output_g: String(weight),
      serving_size: serving ? String(num(serving)) : null,
      ingredients: rows.map((r) => ({
        product_id: r.id,
        amount: String(num(r.amount)),
        mass_g: r.snapshot.unit === 'ml' ? String(num(r.mass)) : null,
      })),
    })
    setBusy(false)
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await cache.invalidateQueries({ queryKey: PRODUCTS_KEY })
    await onSaved(id)
  }
  if (missing)
    return (
      <MissingProduct
        missing={missing}
        onSaved={created}
        cancel={<Button onClick={() => setMissing(undefined)}>{t('products.cancel')}</Button>}
      />
    )
  if (create)
    return (
      <ProductForm
        onSaved={created}
        cancel={<Button onClick={() => setCreate(false)}>{t('products.cancel')}</Button>}
      />
    )
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('dishes.title')}</h1>
      <FormError failure={failure} />
      <TextField
        label={t('dishes.name')}
        value={name}
        disabled={!editable}
        onChange={(e) => setName(e.target.value)}
      />
      <h2>{t('dishes.ingredients')}</h2>
      {rows.map((r) => (
        <div className="grid gap-2 rounded-lg border p-3" key={r.key}>
          <p>{r.snapshot.name}</p>
          {r.removed && <p>{t('dishes.removed')}</p>}
          <TextField
            label={t('dishes.amount', { unit: t(`productUnits.${r.snapshot.unit}`) })}
            inputMode="decimal"
            value={r.amount}
            disabled={!editable}
            onChange={(e) => update(r.key, 'amount', e.target.value)}
          />
          {r.snapshot.unit === 'ml' && (
            <TextField
              label={t('dishes.mass')}
              inputMode="decimal"
              value={r.mass}
              disabled={!editable}
              onChange={(e) => update(r.key, 'mass', e.target.value)}
            />
          )}
          {editable && (
            <Button
              variant="ghost"
              onClick={() => setRows(rows.filter((row) => row.key !== r.key))}
            >
              {t('dishes.remove')}
            </Button>
          )}
        </div>
      ))}
      {editable && (
        <Button variant="outline" onClick={() => setSearch(!search)}>
          {t('dishes.add')}
        </Button>
      )}
      {search && (
        <section className="grid gap-3">
          <TextField
            label={t('products.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {found.data
            ?.filter((p) => p.id !== id)
            .map((p) => (
              <Button variant="outline" key={p.id} onClick={() => add(p)}>
                {p.name}
              </Button>
            ))}
          {found.hasNextPage && (
            <Button onClick={() => void found.fetchNextPage()}>{t('search.more')}</Button>
          )}
          <ExternalSearch q={query} onFound={add} onMissing={setMissing} />
          <Button onClick={() => setCreate(true)}>{t('products.create')}</Button>
        </section>
      )}
      <TextField
        label={t('dishes.output')}
        inputMode="decimal"
        value={output}
        placeholder={String(weight)}
        disabled={!editable}
        onChange={(e) => setOutput(e.target.value)}
      />
      <TextField
        label={t('dishes.serving')}
        inputMode="decimal"
        value={serving}
        disabled={!editable}
        onChange={(e) => setServing(e.target.value)}
      />
      <p>
        {t('dishes.preview', {
          kcal: total('kcal'),
          protein: total('protein_g'),
          fat: total('fat_g'),
          carbs: total('carbs_g'),
        })}
      </p>
      <div className="flex gap-3">
        {editable && (
          <Button disabled={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          {t('products.cancel')}
        </Button>
      </div>
    </div>
  )
}
