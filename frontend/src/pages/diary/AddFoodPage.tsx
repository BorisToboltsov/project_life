import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  DIARY_KEY,
  type Meal,
  type Product,
  saveEntry,
  useProduct,
  useProductSearch,
  useSuggestions,
} from '@/api/nutrition'
import { FormError, TextField } from '@/components/form/fields'
import { numberOf } from '@/components/form/validation'
import { Button } from '@/components/ui/button'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { formatGrams } from '@/lib/nutrition'
import { uuidv7 } from '@/lib/uuid'
import { ProductForm } from '@/pages/products/ProductForm'
import { ProductLine } from '@/pages/products/ProductLine'

import { amountSchema, type AmountValues } from './values'

/** Граммовка по умолчанию для продукта, который пользователь ещё не вносил. */
const DEFAULT_AMOUNT = 100

function AmountForm({
  product,
  amount,
  date,
  meal,
  onAdded,
}: {
  product: Product
  amount: number
  date: string
  meal: Meal
  onAdded: (amount: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ записи живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(uuidv7())
  const form = useForm<AmountValues>({
    resolver: zodResolver(amountSchema),
    defaultValues: { amount: String(amount) },
  })
  const { errors, isSubmitting } = form.formState

  async function submit(values: AmountValues) {
    setFailure(undefined)
    const amount_g = numberOf(values.amount, 1)
    const result = await saveEntry(id.current, {
      local_date: date,
      meal,
      product_id: product.id,
      amount_g,
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    onAdded(amount_g)
  }

  return (
    <form
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
      className="grid gap-3"
    >
      <FormError failure={failure} />
      <TextField
        label={t('addFood.amount')}
        inputMode="decimal"
        autoComplete="off"
        error={errors.amount?.message}
        {...form.register('amount')}
      />
      <Button type="submit" className="h-11 justify-self-start" disabled={isSubmitting}>
        {t('addFood.submit')}
      </Button>
    </form>
  )
}

interface Choice {
  product: Product
  /** Сколько граммов подставить в поле. */
  amount: number
}

function ProductList({
  title,
  choices,
  opened,
  onOpen,
  date,
  meal,
  onAdded,
}: {
  title: string
  choices: Choice[]
  /** Ключ раскрытой строки: продукт бывает сразу в двух списках. */
  opened: string | undefined
  onOpen: (key: string) => void
  date: string
  meal: Meal
  onAdded: (product: Product, amount: number) => void
}) {
  if (choices.length === 0) return null
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <ul aria-label={title} className="grid gap-2">
        {choices.map(({ product, amount }) => {
          const key = `${title}:${product.id}`
          const open = opened === key
          return (
            <li key={product.id} className="grid gap-3 rounded-lg border p-3">
              <button
                type="button"
                className="text-left"
                aria-expanded={open}
                onClick={() => onOpen(key)}
              >
                <ProductLine product={product} />
              </button>
              {open && (
                <AmountForm
                  product={product}
                  amount={amount}
                  date={date}
                  meal={meal}
                  onAdded={(added) => onAdded(product, added)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const route = getRouteApi('/app/diary/$date/add/$meal')

export function AddFoodPage() {
  const { t, i18n } = useTranslation()
  const { date, meal } = route.useParams() as { date: string; meal: Meal }
  const { product: createdId } = route.useSearch() as { product?: string }
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<string>()
  const [added, setAdded] = useState<{ name: string; amount: number }>()
  const q = query.trim()
  const found = useProductSearch(q, q !== '')
  const suggestions = useSuggestions()
  const created = useProduct(createdId)
  // Созданный продукт показывается отдельно, пока его не внесли: дальше он в «недавних».
  const justCreated =
    created.data && !suggestions.data?.recent.some((item) => item.id === created.data?.id)
      ? created.data
      : undefined

  const titles = {
    created: t('addFood.created'),
    frequent: t('addFood.frequent'),
    recent: t('addFood.recent'),
    results: t('addFood.results'),
  }
  // Только что созданный продукт раскрыт сразу: осталось ввести граммы.
  const openedKey = opened ?? (justCreated ? `${titles.created}:${justCreated.id}` : undefined)
  const lists = { opened: openedKey, onOpen: setOpened, date, meal, onAdded }

  function onAdded(product: Product, amount: number) {
    setAdded({ name: product.name, amount })
    setOpened('')
    setQuery('')
  }

  const fresh = (products: Product[]): Choice[] =>
    products.map((product) => ({ product, amount: DEFAULT_AMOUNT }))
  const nothingToSuggest = suggestions.data?.recent.length === 0 && !justCreated

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">
        {t('addFood.title', { meal: t(`meals.${meal}`), date: isoToDisplay(date) })}
      </h1>
      {added && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('addFood.added', {
            name: added.name,
            amount: formatGrams(added.amount, i18n.language),
          })}
        </p>
      )}
      <TextField
        label={t('addFood.search')}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {q ? (
        <>
          <ProductList title={titles.results} choices={fresh(found.data ?? [])} {...lists} />
          {found.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('addFood.nothingFound')}</p>
          )}
        </>
      ) : (
        <>
          <ProductList
            title={titles.created}
            choices={fresh(justCreated ? [justCreated] : [])}
            {...lists}
          />
          <ProductList
            title={titles.frequent}
            choices={(suggestions.data?.frequent ?? []).map((item) => ({
              product: item,
              amount: item.amount_g,
            }))}
            {...lists}
          />
          <ProductList
            title={titles.recent}
            choices={(suggestions.data?.recent ?? []).map((item) => ({
              product: item,
              amount: item.amount_g,
            }))}
            {...lists}
          />
          {nothingToSuggest && <p className="text-sm text-muted-foreground">{t('addFood.hint')}</p>}
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Button asChild className="h-11">
          <Link to="/diary/$date" params={{ date }}>
            {t('addFood.done')}
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link to="/diary/$date/add/$meal/new" params={{ date, meal }}>
            {t('addFood.createProduct')}
          </Link>
        </Button>
      </div>
    </div>
  )
}

const newRoute = getRouteApi('/app/diary/$date/add/$meal/new')

/** Создание продукта по пути в приём пищи: после сохранения возвращает к вводу граммов. */
export function AddFoodNewProductPage() {
  const { t } = useTranslation()
  const { date, meal } = newRoute.useParams() as { date: string; meal: Meal }
  const navigate = useNavigate()

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('products.newTitle')}</h1>
      <ProductForm
        onSaved={(product) =>
          navigate({ to: '/diary/$date/add/$meal', params: { date, meal }, search: { product } })
        }
        cancel={
          <Button asChild variant="ghost" className="h-11">
            <Link to="/diary/$date/add/$meal" params={{ date, meal }}>
              {t('products.cancel')}
            </Link>
          </Button>
        }
      />
    </div>
  )
}
