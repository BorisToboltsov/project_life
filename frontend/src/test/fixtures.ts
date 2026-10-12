import type { Schemas } from '@/api/client'
import type { User } from '@/auth/session'

export const anna: User = {
  id: '0199b7a0-0000-7000-8000-000000000001',
  email: 'anna@example.com',
  display_name: 'Анна',
  role: 'user',
  language: 'ru',
  timezone: 'Europe/Moscow',
  unit_system: 'metric',
  sex: null,
  birth_date: null,
  height_cm: null,
}

export const boris: User = { ...anna, id: '0199b7a0-0000-7000-8000-000000000002', role: 'admin' }

export function sessionOf(user: User, token = 'access-1'): Schemas['SessionOut'] {
  return { access_token: token, expires_in: 900, user }
}

export const metricTypes: Schemas['MetricTypeOut'][] = [
  { code: 'weight', quantity: 'mass', unit: 'kg', min_value: 2, max_value: 500 },
  { code: 'neck', quantity: 'length', unit: 'cm', min_value: 15, max_value: 80 },
  { code: 'waist', quantity: 'length', unit: 'cm', min_value: 30, max_value: 250 },
  { code: 'hips', quantity: 'length', unit: 'cm', min_value: 30, max_value: 250 },
]

let sequence = 0

/** Замер веса в килограммах на дату `local_date`; остальное — через `overrides`. */
export function measurement(
  local_date: string,
  value: number,
  overrides: Partial<Schemas['MeasurementOut']> = {},
): Schemas['MeasurementOut'] {
  sequence += 1
  return {
    id: `0199b7a0-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    metric: 'weight',
    value,
    unit: 'kg',
    original_value: value,
    original_unit: 'kg',
    measured_at: `${local_date}T07:00:00Z`,
    local_date,
    ...overrides,
  }
}

export function summaryOf(
  entries: Partial<
    Record<Schemas['Metric'], [Schemas['MeasurementOut'], Schemas['MeasurementOut']?]>
  >,
): Schemas['MetricSummary'][] {
  return metricTypes.map(({ code }) => ({
    metric: code,
    latest: entries[code]?.[0] ?? null,
    previous: entries[code]?.[1] ?? null,
  }))
}

/** Чего нет на этикетке или что с неё не внесли. */
export const noLabel = { saturated_fat_g: null, sugars_g: null, fiber_g: null, salt_g: null }

/** Страница поиска в Open Food Facts. */
export function outsideOf(
  items: Schemas['ExternalProductOut'][],
  next: number | null = null,
): Schemas['ExternalSearchOut'] {
  return { status: 'ok', items, next_page: next }
}

export const cottageCheese: Schemas['ProductOut'] = {
  id: '0199b7a0-0000-7000-8000-0000000000c1',
  name: 'Творог 5 %',
  unit: 'g',
  kcal: 121,
  protein_g: 17.2,
  fat_g: 5,
  carbs_g: 1.8,
  ...noLabel,
  barcode: null,
  source: 'user',
  editable: true,
}

export const oatmeal: Schemas['ProductOut'] = {
  id: '0199b7a0-0000-7000-8000-0000000000c2',
  name: 'Овсяные хлопья',
  unit: 'g',
  kcal: 352,
  protein_g: 12.3,
  fat_g: 6.2,
  carbs_g: 61.8,
  ...noLabel,
  barcode: null,
  source: 'user',
  editable: false,
}

export const kefir: Schemas['ProductOut'] = {
  id: '0199b7a0-0000-7000-8000-0000000000c3',
  name: 'Кефир 1 %',
  unit: 'ml',
  kcal: 40,
  protein_g: 3,
  fat_g: 1,
  carbs_g: 4,
  ...noLabel,
  barcode: null,
  source: 'user',
  editable: true,
}

function presetMeal(preset: Schemas['MealPreset'], number: number): Schemas['MealOut'] {
  return { id: `0199b7a0-0000-7000-8000-0000000000a${number}`, preset, name: null, archived: false }
}

/** Приёмы пищи, с которыми начинает каждый пользователь. */
export const meals = {
  breakfast: presetMeal('breakfast', 1),
  lunch: presetMeal('lunch', 2),
  dinner: presetMeal('dinner', 3),
  snack: presetMeal('snack', 4),
}

/** Свой приём пищи: его назвал пользователь. */
export const secondBreakfast: Schemas['MealOut'] = {
  id: '0199b7a0-0000-7000-8000-0000000000a5',
  preset: null,
  name: 'Второй завтрак',
  archived: false,
}

/**
 * Запись дневника: `amount` единиц продукта в завтраке; нутриенты считаются от его состава.
 * Другой приём пищи — через `overrides.meal_id`.
 */
export function foodEntry(
  product: Schemas['ProductOut'],
  amount: number,
  overrides: Partial<Schemas['FoodEntryOut']> = {},
): Schemas['FoodEntryOut'] {
  sequence += 1
  const portion = (per100: number) => Math.round(per100 * amount) / 100
  return {
    id: `0199b7a0-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    local_date: '2026-10-11',
    meal_id: meals.breakfast.id,
    product_id: product.id,
    product_name: product.name,
    amount,
    unit: product.unit,
    kcal: portion(product.kcal),
    protein_g: portion(product.protein_g),
    fat_g: portion(product.fat_g),
    carbs_g: portion(product.carbs_g),
    ...overrides,
  }
}

function totalsOf(entries: Schemas['FoodEntryOut'][]): Schemas['NutrientsOut'] {
  const sum = (pick: (entry: Schemas['FoodEntryOut']) => number) =>
    Math.round(entries.reduce((total, entry) => total + pick(entry), 0) * 100) / 100
  return {
    kcal: sum((entry) => entry.kcal),
    protein_g: sum((entry) => entry.protein_g),
    fat_g: sum((entry) => entry.fat_g),
    carbs_g: sum((entry) => entry.carbs_g),
  }
}

export const dailyGoal: Schemas['NutritionGoalOut'] = {
  kcal: 2100,
  protein_g: 130,
  fat_g: 70,
  carbs_g: 230,
  effective_from: '2026-10-01',
}

/**
 * День дневника из записей: раскладывает их по приёмам пищи и считает итоги. Без `list` в
 * дне четыре предустановленных приёма.
 */
export function diaryDay(
  local_date: string,
  entries: Schemas['FoodEntryOut'][] = [],
  goal: Schemas['NutritionGoalOut'] | null = null,
  list: Schemas['MealOut'][] = Object.values(meals),
): Schemas['DiaryDayOut'] {
  const dated = entries.map((entry) => ({ ...entry, local_date }))
  return {
    local_date,
    meals: list.map((meal) => {
      const own = dated.filter((entry) => entry.meal_id === meal.id)
      return { ...meal, entries: own, totals: totalsOf(own) }
    }),
    totals: totalsOf(dated),
    goal,
  }
}
