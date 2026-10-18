import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { today } from '@/lib/dates'
import { attempt, type ErrorKey } from '@/lib/errors'
import { portionsAmount, sizesOf } from '@/lib/portions'
import type { ChangeContext } from '@/offline/db'
import {
  DIARY_COPY,
  dayOffline,
  diaryCopy,
  entryFromCopy,
  forgetProduct,
  historyOffline,
  productByBarcode,
  productFromCopy,
  rememberProduct,
  searchCatalog,
} from '@/offline/diary'
import { readOr, readThrough, write } from '@/offline/queue'
import { offlineState } from '@/offline/store'

import { api, type Schemas } from './client'

export type MealPreset = Schemas['MealPreset']
/** Приём пищи из списка пользователя. */
export type Meal = Schemas['MealOut']
/** Приём пищи в дне: с записями и съеденным. */
export type DayMeal = Schemas['DayMealOut']
export type ProductUnit = Schemas['ProductUnit']
export type Product = Schemas['ProductOut']
/** Чем кончился поиск продукта по штрихкоду. */
export type BarcodeLookup = Schemas['BarcodeLookupOut']
/** Что источник знает о продукте, которого нет в каталоге. */
export type ProductDraft = Schemas['ProductDraftOut']
/** Продукт из Open Food Facts, найденный по названию: в каталоге его ещё нет. */
export type ExternalProduct = Schemas['ExternalProductOut']
/** Страница поиска в Open Food Facts; `failure` — запрос к своему серверу не удался. */
export type ExternalPage = Schemas['ExternalSearchOut'] & { failure?: ErrorKey }
export type Suggestion = Schemas['SuggestionOut']
export type FoodEntry = Schemas['FoodEntryOut']
export type Nutrients = Schemas['NutrientsOut']
export type DiaryDay = Schemas['DiaryDayOut']
/** Порция выпитой воды. */
export type WaterIntake = Schemas['WaterIntakeOut']
export type NutritionGoal = Schemas['NutritionGoalOut']

/** В чём измеряется продукт. */
export const PRODUCT_UNITS: ProductUnit[] = ['g', 'ml']

/** Все запросы дневника начинаются с этого ключа: любая запись сбрасывает их разом. */
export const DIARY_KEY = ['diary'] as const
/** То же для каталога продуктов. */
export const PRODUCTS_KEY = ['products'] as const

/** День дневника: записи по приёмам пищи, съеденное, выпитая вода и цель этого дня. */
export function useDiaryDay(date: string) {
  return useQuery({
    queryKey: [...DIARY_KEY, 'day', date],
    networkMode: 'always',
    // Без сети — день из копии, будущий — пустым; старый день вне копии — `null` (ADR 0020).
    queryFn: async () =>
      (await readThrough(DIARY_COPY.day(date), () =>
        api.GET('/api/diary', { params: { query: { date } } }),
      )) ??
      (offlineState.get().online ? undefined : await dayOffline(date)) ??
      null,
  })
}

/**
 * Продукты, которые пользователь вносит: чаще всего в приём пищи `mealId`, недавно и часто
 * вообще.
 */
export function useSuggestions(mealId: string, productId?: string) {
  return useQuery({
    queryKey: [...DIARY_KEY, 'suggestions', mealId, productId],
    networkMode: 'always',
    queryFn: async () => {
      const load = () =>
        api.GET('/api/diary/suggestions', {
          params: { query: { meal_id: mealId, product_id: productId } },
        })
      // Подсказки приёма пищи — последние ответы сервера; история продукта — по копии.
      const found = productId
        ? await readOr(load, () => historyOffline(productId, mealId))
        : await readThrough(DIARY_COPY.suggestions(mealId), load)
      return found ?? null
    },
  })
}

/** Действующая цель на день; `null` — не задана. */
export function useNutritionGoal() {
  return useQuery({
    queryKey: [...DIARY_KEY, 'goal'],
    networkMode: 'always',
    queryFn: async () =>
      (await readThrough(DIARY_COPY.goal, () => api.GET('/api/diary/goal'))) ?? null,
  })
}

/** Заголовок ответа каталога: с какого продукта продолжать; нет — список кончился. */
const NEXT_OFFSET = 'X-Next-Offset'

/** Строки без повторов: каталог мог измениться между запросами двух страниц. */
function distinct<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

/**
 * Поиск по каталогу, страница за страницей; пустой запрос — каталог по алфавиту. Пока идёт
 * новый запрос, остаётся прежний список: строки не мигают при наборе.
 */
export function useProductSearch(
  q: string,
  enabled = true,
  kind: 'all' | 'products' | 'dishes' = 'all',
) {
  return useInfiniteQuery({
    queryKey: [...PRODUCTS_KEY, 'search', q, kind],
    enabled,
    networkMode: 'always',
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    // Без сети ищет по каталогу на телефоне так же, как сервер (ADR 0020).
    queryFn: async ({ pageParam }) => {
      const page = await readOr(
        async () => {
          const { data, response } = await api.GET('/api/products', {
            params: { query: { q, offset: pageParam, ...(kind !== 'all' ? { kind } : {}) } },
          })
          const next = Number(response.headers.get(NEXT_OFFSET))
          return { data: data && { items: data, next: next > 0 ? next : undefined }, response }
        },
        () => searchCatalog(q, pageParam, kind),
      )
      return page ?? { items: [], next: undefined }
    },
    getNextPageParam: (last) => last.next,
    select: (data) =>
      distinct(
        data.pages.flatMap((page) => page.items),
        (product) => product.id,
      ),
  })
}

/**
 * Продукты Open Food Facts по названию — те, которых ещё нет в каталоге. Каждая страница —
 * запрос сервера наружу, а их число ограничено: сам по себе поиск не повторяется, только
 * когда изменился каталог или человек попросил.
 */
export function useExternalSearch(q: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...PRODUCTS_KEY, 'external', q],
    enabled,
    staleTime: Infinity,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<ExternalPage> => {
      const result = await attempt(() =>
        api.GET('/api/products/external', { params: { query: { q, page: pageParam } } }),
      )
      return result.failure
        ? { status: 'unavailable', items: [], next_page: null, failure: result.failure }
        : result.data
    },
    getNextPageParam: (last) => last.next_page ?? undefined,
    select: (data) => ({
      items: distinct(
        data.pages.flatMap((page) => page.items),
        (product) => product.barcode,
      ),
      // Чем кончилась последняя страница: на ней поиск мог споткнуться.
      last: data.pages.at(-1),
    }),
  })
}

/** Ключ запроса одного продукта: найденный по штрихкоду кладётся в кэш под ним же. */
export const productKey = (id: string | undefined) => [...PRODUCTS_KEY, 'one', id] as const

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKey(id),
    enabled: id !== undefined,
    networkMode: 'always',
    queryFn: async () =>
      (await readOr(
        () => api.GET('/api/products/{product_id}', { params: { path: { product_id: id! } } }),
        () => productFromCopy(id),
      )) ?? null,
  })
}

/** Продукт заводят и правят только при связи; сохранённый сразу попадает и в копию. */
export async function saveProduct(
  id: string,
  body: Schemas['ProductIn-Input'] | Schemas['DishIn'],
) {
  const result = await attempt(() =>
    api.PUT('/api/products/{product_id}', { params: { path: { product_id: id } }, body }),
  )
  if (result.data) await rememberProduct(result.data)
  return result
}

/**
 * Продукт по штрихкоду: свой каталог, затем Open Food Facts. Найденный там полный продукт
 * сервер сам кладёт в каталог.
 */
export async function lookupBarcode(barcode: string) {
  const fromCopy = async () => {
    // Без сети знакомый продукт находится в каталоге на телефоне (ADR 0020).
    const product = await productByBarcode(barcode)
    return product
      ? { data: { status: 'found' as const, barcode, product, draft: null } }
      : { failure: 'errors.network' as const }
  }
  if (!offlineState.get().online) return fromCopy()
  const result = await attempt(() => api.POST('/api/products/lookup', { body: { barcode } }))
  if (result.failure === 'errors.network') {
    offlineState.setOnline(false)
    return fromCopy()
  }
  if (result.data?.product) await rememberProduct(result.data.product)
  return result
}

export async function deleteProduct(id: string) {
  const result = await attempt(() =>
    api.DELETE('/api/products/{product_id}', { params: { path: { product_id: id } } }),
  )
  if (!result.failure) await forgetProduct(id)
  return result
}

/** Сколько внесли — в единицах продукта и, если порциями, какими. */
function quantityOf(
  body: Schemas['FoodEntryIn'] | undefined,
  product: Product | undefined,
  old: FoodEntry | undefined,
): { amount: number; portion: Schemas['PortionOut'] | null } {
  if (!body) return { amount: old?.amount ?? 0, portion: old?.portion ?? null }
  if (!body.portion) return { amount: Number(body.amount), portion: null }
  const count = Number(body.portion.count)
  const size = product ? sizesOf(product)[body.portion.kind] : undefined
  return size === undefined
    ? { amount: 0, portion: null }
    : { amount: portionsAmount(count, size), portion: { kind: body.portion.kind, size, count } }
}

/** Что и сколько — для строки «Не отправлено»: из копии, как запись видна на телефоне. */
async function aboutEntry(
  kind: 'entry' | 'entryRemove',
  id: string,
  body?: Schemas['FoodEntryIn'],
): Promise<ChangeContext> {
  const date = body?.local_date
  const old = await entryFromCopy(id)
  const product = await productFromCopy(body?.product_id ?? old?.product_id)
  const name = product?.name ?? old?.product_name
  return {
    kind,
    localDate: date ?? old?.local_date,
    ...(name && {
      food: {
        productName: name,
        ...quantityOf(body, product, old),
        unit: product?.unit ?? old?.unit ?? 'g',
        mealId: body?.meal_id ?? old?.meal_id ?? '',
      },
    }),
  }
}

export async function saveEntry(id: string, body: Schemas['FoodEntryIn']) {
  return write<FoodEntry>(
    {
      method: 'PUT',
      path: '/api/diary/entries/{entry_id}',
      params: { entry_id: id },
      body,
      context: await aboutEntry('entry', id, body),
    },
    () => diaryCopy.saveEntry(id, body),
  )
}

export async function deleteEntry(id: string) {
  return write(
    {
      method: 'DELETE',
      path: '/api/diary/entries/{entry_id}',
      params: { entry_id: id },
      context: await aboutEntry('entryRemove', id),
    },
    () => diaryCopy.deleteEntry(id),
  )
}

export function saveMeal(id: string, body: Schemas['MealIn']) {
  return attempt(() =>
    api.PUT('/api/diary/meals/{meal_id}', { params: { path: { meal_id: id } }, body }),
  )
}

export function deleteMeal(id: string) {
  return attempt(() =>
    api.DELETE('/api/diary/meals/{meal_id}', { params: { path: { meal_id: id } } }),
  )
}

export async function saveWater(id: string, body: Schemas['WaterIntakeIn']) {
  return write<WaterIntake>(
    {
      method: 'PUT',
      path: '/api/diary/water/{intake_id}',
      params: { intake_id: id },
      body,
      context: { kind: 'water', localDate: body.local_date, waterMl: body.amount_ml },
    },
    () => diaryCopy.saveWater(id, body),
  )
}

export async function deleteWater(id: string) {
  return write(
    {
      method: 'DELETE',
      path: '/api/diary/water/{intake_id}',
      params: { intake_id: id },
      context: { kind: 'waterRemove', localDate: today() },
    },
    () => diaryCopy.deleteWater(id),
  )
}

export function copyEntries(body: Schemas['DiaryCopyIn']) {
  return attempt(() => api.POST('/api/diary/copy', { body }))
}

export function saveGoal(body: Schemas['NutritionGoalIn']) {
  return attempt(() => api.PUT('/api/diary/goal', { body }))
}
