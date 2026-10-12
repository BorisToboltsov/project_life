import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { ScanBarcode } from 'lucide-react'
import { useRef, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  DIARY_KEY,
  type Meal,
  type Product,
  saveEntry,
  type Suggestion,
  useDiaryDay,
  useProduct,
  useProductSearch,
  useSuggestions,
} from '@/api/nutrition'
import { FormError, TextField } from '@/components/form/fields'
import { Button } from '@/components/ui/button'
import { isoToDisplay } from '@/lib/dates'
import type { ErrorKey } from '@/lib/errors'
import { sizesOf } from '@/lib/portions'
import { uuidv7 } from '@/lib/uuid'
import { ExternalSearch } from '@/pages/products/ExternalSearch'
import type { Missing } from '@/pages/products/lookup'
import { MissingProduct } from '@/pages/products/MissingProduct'
import { ProductForm } from '@/pages/products/ProductForm'
import { ProductLine } from '@/pages/products/ProductLine'

import { useMealName } from './mealName'
import { MealNotFound } from './MealNotFound'
import {
  type Entered,
  entered,
  firstQuantity,
  howMuch,
  type Quantity,
  quantityOf,
  quantitySchema,
} from './quantity'
import { QuantityField } from './QuantityField'
import { useQuantityText } from './quantityText'

function AmountForm({
  product,
  quantity,
  date,
  meal,
  onAdded,
}: {
  product: Product
  quantity: Quantity
  date: string
  meal: Meal
  onAdded: (added: Entered) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<ErrorKey>()
  // Ключ записи живёт, пока открыта форма: повторная отправка после сбоя не создаст дубль.
  const id = useRef(uuidv7())
  const sizes = sizesOf(product)
  const form = useForm<Quantity>({
    resolver: zodResolver(quantitySchema(sizes)),
    defaultValues: quantity,
  })

  async function submit(values: Quantity) {
    setFailure(undefined)
    const result = await saveEntry(id.current, {
      local_date: date,
      meal_id: meal.id,
      product_id: product.id,
      ...howMuch(values),
    })
    if (result.failure) {
      setFailure(result.failure)
      return
    }
    await queryClient.invalidateQueries({ queryKey: DIARY_KEY })
    onAdded(entered(values, sizes))
  }

  return (
    <FormProvider {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        noValidate
        className="grid gap-3"
      >
        <FormError failure={failure} />
        <QuantityField unit={product.unit} sizes={sizes} kcal={product.kcal} />
        <Button
          type="submit"
          className="h-11 justify-self-start"
          disabled={form.formState.isSubmitting}
        >
          {t('addFood.submit')}
        </Button>
      </form>
    </FormProvider>
  )
}

interface Choice {
  product: Product
  /** Что подставить в поле: мера и число в ней. */
  quantity: Quantity
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
  onAdded: (product: Product, added: Entered) => void
}) {
  if (choices.length === 0) return null
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <ul aria-label={title} className="grid gap-2">
        {choices.map(({ product, quantity }) => {
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
                  quantity={quantity}
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

function AddFood({ date, meal }: { date: string; meal: Meal }) {
  const { t } = useTranslation()
  const quantityText = useQuantityText()
  const {
    product: createdId,
    scanned: scannedId,
    picked: pickedId,
  } = route.useSearch() as { product?: string; scanned?: string; picked?: string }
  const navigate = useNavigate()
  const mealName = useMealName()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<string>()
  const [added, setAdded] = useState<{ product: Product; quantity: Entered }>()
  // Продукт из Open Food Facts, состав которого нужно дополнить: вместо списков — форма.
  const [missing, setMissing] = useState<Missing>()
  const q = query.trim()
  const found = useProductSearch(q, q !== '')
  const suggestions = useSuggestions(meal.id)
  const created = useProduct(createdId)
  // Продукт, с которым сюда пришли из сканера или из поиска в Open Food Facts.
  const broughtId = scannedId ?? pickedId
  const byId = useProduct(broughtId)
  // Количество подставляется из подсказок, поэтому такой продукт ждёт их.
  const brought = suggestions.isPending ? undefined : (byId.data ?? undefined)
  // Созданный продукт показывается отдельно, пока его не внесли: дальше он в «недавних».
  const justCreated =
    created.data && !suggestions.data?.recent.some((item) => item.id === created.data?.id)
      ? created.data
      : undefined

  const titles = {
    brought: scannedId ? t('addFood.scanned') : t('addFood.picked'),
    created: t('addFood.created'),
    inMeal: t('addFood.inMeal'),
    frequent: t('addFood.frequent'),
    recent: t('addFood.recent'),
    results: t('search.inCatalog'),
  }
  const here = { to: '/diary/$date/add/$meal', params: { date, meal: meal.id } } as const
  // Продукт, с которым пришли, и только что созданный раскрыты сразу: осталось ввести
  // количество.
  const chosen = brought
    ? `${titles.brought}:${brought.id}`
    : justCreated && `${titles.created}:${justCreated.id}`
  const lists = { opened: opened ?? (chosen || undefined), onOpen: setOpened, date, meal, onAdded }

  function onAdded(product: Product, quantity: Entered) {
    setAdded({ product, quantity })
    setOpened('')
    setQuery('')
    // Продукт, с которым пришли, внесён: при возврате на экран он снова не всплывёт.
    if (broughtId) void navigate({ ...here, search: {}, replace: true })
  }

  /** Продукт выбран в Open Food Facts и уже в каталоге: осталось ввести количество. */
  async function onPicked(product: Product) {
    setQuery('')
    setOpened(undefined)
    await navigate({ ...here, search: { picked: product.id }, replace: true })
  }

  if (missing) {
    return (
      <MissingProduct
        missing={missing}
        onSaved={async (product) => {
          setMissing(undefined)
          setQuery('')
          await navigate({ ...here, search: { product }, replace: true })
        }}
        cancel={
          <Button variant="ghost" className="h-11" onClick={() => setMissing(undefined)}>
            {t('products.cancel')}
          </Button>
        }
      />
    )
  }

  const fresh = (products: Product[]): Choice[] =>
    products.map((product) => ({ product, quantity: firstQuantity(product) }))
  const remembered = (items: Suggestion[] = []): Choice[] =>
    items.map((item) => ({ product: item, quantity: quantityOf(item) }))
  const inMeal = remembered(suggestions.data?.in_meal)
  // Знакомому продукту — количество из прошлого раза, лучше всего из этого же приёма пищи.
  const lastQuantity = (product: Product) => {
    const last = [...(suggestions.data?.in_meal ?? []), ...(suggestions.data?.recent ?? [])].find(
      (item) => item.id === product.id,
    )
    return last ? quantityOf(last) : firstQuantity(product)
  }
  const nothingToSuggest = suggestions.data?.recent.length === 0 && !justCreated && !brought

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">
        {t('addFood.title', { meal: mealName(meal), date: isoToDisplay(date) })}
      </h1>
      {added && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('addFood.added', {
            name: added.product.name,
            quantity: quantityText({ ...added.quantity, unit: added.product.unit }),
          })}
        </p>
      )}
      <Button asChild variant="outline" className="h-11 justify-self-start">
        <Link to="/diary/$date/add/$meal/scan" params={{ date, meal: meal.id }}>
          <ScanBarcode aria-hidden="true" />
          {t('addFood.scan')}
        </Link>
      </Button>
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
          {found.hasNextPage && (
            <Button
              variant="outline"
              className="h-11 justify-self-start"
              disabled={found.isFetchingNextPage}
              onClick={() => void found.fetchNextPage()}
            >
              {t('search.more')}
            </Button>
          )}
          <ExternalSearch q={q} onFound={onPicked} onMissing={setMissing} />
        </>
      ) : (
        <>
          <ProductList
            title={titles.brought}
            choices={brought ? [{ product: brought, quantity: lastQuantity(brought) }] : []}
            {...lists}
          />
          {brought?.source === 'open_food_facts' && (
            <p className="text-sm text-muted-foreground">{t('products.fromOpenFoodFacts')}</p>
          )}
          <ProductList
            title={titles.created}
            choices={fresh(justCreated ? [justCreated] : [])}
            {...lists}
          />
          {/* То, что обычно едят в этот приём пищи; пока такого нет — частое вообще. */}
          {inMeal.length > 0 ? (
            <ProductList title={titles.inMeal} choices={inMeal} {...lists} />
          ) : (
            <ProductList
              title={titles.frequent}
              choices={remembered(suggestions.data?.frequent)}
              {...lists}
            />
          )}
          <ProductList
            title={titles.recent}
            choices={remembered(suggestions.data?.recent)}
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
          <Link to="/diary/$date/add/$meal/new" params={{ date, meal: meal.id }}>
            {t('addFood.createProduct')}
          </Link>
        </Button>
      </div>
    </div>
  )
}

const route = getRouteApi('/app/diary/$date/add/$meal')

export function AddFoodPage() {
  const { t } = useTranslation()
  const { date, meal: mealId } = route.useParams() as { date: string; meal: string }
  const day = useDiaryDay(date)
  const meal = day.data?.meals.find((item) => item.id === mealId)

  if (day.isPending) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  if (!meal) {
    return <MealNotFound date={date} />
  }
  return <AddFood date={date} meal={meal} />
}

const newRoute = getRouteApi('/app/diary/$date/add/$meal/new')

/** Создание продукта по пути в приём пищи: после сохранения возвращает к вводу граммов. */
export function AddFoodNewProductPage() {
  const { t } = useTranslation()
  const { date, meal } = newRoute.useParams() as { date: string; meal: string }
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
