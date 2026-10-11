import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

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
export type Suggestion = Schemas['SuggestionOut']
export type FoodEntry = Schemas['FoodEntryOut']
export type Nutrients = Schemas['NutrientsOut']
export type DiaryDay = Schemas['DiaryDayOut']
export type NutritionGoal = Schemas['NutritionGoalOut']

/** В чём измеряется продукт. */
export const PRODUCT_UNITS: ProductUnit[] = ['g', 'ml']

/** Все запросы дневника начинаются с этого ключа: любая запись сбрасывает их разом. */
export const DIARY_KEY = ['diary'] as const
/** То же для каталога продуктов. */
export const PRODUCTS_KEY = ['products'] as const

/** День дневника: записи по приёмам пищи, съеденное и цель этого дня. */
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
export function useSuggestions(mealId: string) {
  return useQuery({
    queryKey: [...DIARY_KEY, 'suggestions', mealId],
    queryFn: async () =>
      (await api.GET('/api/diary/suggestions', { params: { query: { meal_id: mealId } } })).data ??
      null,
  })
}

/** Действующая цель на день; `null` — не задана. */
export function useNutritionGoal() {
  return useQuery({
    queryKey: [...DIARY_KEY, 'goal'],
    queryFn: async () => (await api.GET('/api/diary/goal')).data ?? null,
  })
}

/**
 * Поиск по каталогу; пустой запрос — начало каталога по алфавиту. Пока идёт новый
 * запрос, остаётся прежний список: строки не мигают при наборе.
 */
export function useProductSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, 'search', q],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.GET('/api/products', { params: { query: { q } } })).data ?? [],
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

export function saveProduct(id: string, body: Schemas['ProductIn']) {
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

export function copyEntries(body: Schemas['DiaryCopyIn']) {
  return attempt(() => api.POST('/api/diary/copy', { body }))
}

export function saveGoal(body: Schemas['NutritionGoalIn']) {
  return attempt(() => api.PUT('/api/diary/goal', { body }))
}
