import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { attempt } from '@/lib/errors'

import { api, type Schemas } from './client'

export type Meal = Schemas['Meal']
export type Product = Schemas['ProductOut']
export type Suggestion = Schemas['SuggestionOut']
export type FoodEntry = Schemas['FoodEntryOut']
export type Nutrients = Schemas['NutrientsOut']
export type DiaryDay = Schemas['DiaryDayOut']
export type NutritionGoal = Schemas['NutritionGoalOut']

/** Приёмы пищи в порядке дня. */
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

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

/** Продукты, которые пользователь вносил недавно и вносит часто. */
export function useSuggestions() {
  return useQuery({
    queryKey: [...DIARY_KEY, 'suggestions'],
    queryFn: async () => (await api.GET('/api/diary/suggestions')).data ?? null,
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

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, 'one', id],
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

export function copyEntries(body: Schemas['DiaryCopyIn']) {
  return attempt(() => api.POST('/api/diary/copy', { body }))
}

export function saveGoal(body: Schemas['NutritionGoalIn']) {
  return attempt(() => api.PUT('/api/diary/goal', { body }))
}
