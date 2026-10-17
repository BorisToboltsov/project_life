import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { attempt, type ErrorKey } from '@/lib/errors'

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
    queryFn: async () =>
      (await api.GET('/api/diary', { params: { query: { date } } })).data ?? null,
  })
}

/**
 * Продукты, которые пользователь вносит: чаще всего в приём пищи `mealId`, недавно и часто
 * вообще.
 */
export function useSuggestions(mealId: string, productId?: string) {
  return useQuery({
    queryKey: [...DIARY_KEY, 'suggestions', mealId, productId],
    queryFn: async () =>
      (
        await api.GET('/api/diary/suggestions', {
          params: { query: { meal_id: mealId, product_id: productId } },
        })
      ).data ?? null,
  })
}

/** Действующая цель на день; `null` — не задана. */
export function useNutritionGoal() {
  return useQuery({
    queryKey: [...DIARY_KEY, 'goal'],
    queryFn: async () => (await api.GET('/api/diary/goal')).data ?? null,
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
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, response } = await api.GET('/api/products', {
        params: { query: { q, offset: pageParam, ...(kind !== 'all' ? { kind } : {}) } },
      })
      const next = Number(response.headers.get(NEXT_OFFSET))
      return { items: data ?? [], next: next > 0 ? next : undefined }
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
    queryFn: async () =>
      (await api.GET('/api/products/{product_id}', { params: { path: { product_id: id! } } }))
        .data ?? null,
  })
}

export function saveProduct(id: string, body: Schemas['ProductIn-Input'] | Schemas['DishIn']) {
  return attempt(() =>
    api.PUT('/api/products/{product_id}', { params: { path: { product_id: id } }, body }),
  )
}

/**
 * Продукт по штрихкоду: свой каталог, затем Open Food Facts. Найденный там полный продукт
 * сервер сам кладёт в каталог.
 */
export function lookupBarcode(barcode: string) {
  return attempt(() => api.POST('/api/products/lookup', { body: { barcode } }))
}

export function deleteProduct(id: string) {
  return attempt(() =>
    api.DELETE('/api/products/{product_id}', { params: { path: { product_id: id } } }),
  )
}

export function saveEntry(id: string, body: Schemas['FoodEntryIn']) {
  return attempt(() =>
    api.PUT('/api/diary/entries/{entry_id}', { params: { path: { entry_id: id } }, body }),
  )
}

export function deleteEntry(id: string) {
  return attempt(() =>
    api.DELETE('/api/diary/entries/{entry_id}', { params: { path: { entry_id: id } } }),
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

export function saveWater(id: string, body: Schemas['WaterIntakeIn']) {
  return attempt(() =>
    api.PUT('/api/diary/water/{intake_id}', { params: { path: { intake_id: id } }, body }),
  )
}

export function deleteWater(id: string) {
  return attempt(() =>
    api.DELETE('/api/diary/water/{intake_id}', { params: { path: { intake_id: id } } }),
  )
}

export function copyEntries(body: Schemas['DiaryCopyIn']) {
  return attempt(() => api.POST('/api/diary/copy', { body }))
}

export function saveGoal(body: Schemas['NutritionGoalIn']) {
  return attempt(() => api.PUT('/api/diary/goal', { body }))
}
