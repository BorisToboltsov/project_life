import type { Schemas } from '@/api/client'
import { today } from '@/lib/dates'
import { portionsAmount, sizesOf } from '@/lib/portions'

import { copy } from './copy'

type Day = Schemas['DiaryDayOut']
type DayMeal = Schemas['DayMealOut']
type Entry = Schemas['FoodEntryOut']
type Product = Schemas['ProductOut']
type Nutrients = Schemas['NutrientsOut']
type Portion = Schemas['PortionOut']
type Goal = Schemas['NutritionGoalOut']
type Suggestion = Schemas['SuggestionOut']
type Suggestions = Schemas['SuggestionsOut']

/** Ключи копии дневника (ADR 0020). */
export const DIARY_COPY = {
  catalog: 'catalog',
  goal: 'goal',
  dayPrefix: 'day:',
  day: (date: string) => `day:${date}`,
  suggestionsPrefix: 'suggestions:',
  suggestions: (mealId: string) => `suggestions:${mealId}`,
} as const

/** Каталог целиком и метка, с которой его отдал сервер. */
export interface CatalogCopy {
  etag: string | null
  products: Product[]
}

/** Столько продуктов на странице поиска — как у сервера. */
const PAGE_SIZE = 20
/** Столько продуктов в каждой подсказке — как у сервера. */
const SUGGESTIONS = 10

const ZERO: Nutrients = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }
const KEYS = ['kcal', 'protein_g', 'fat_g', 'carbs_g'] as const

// Итог дня — по правилам сервера (`app.nutrition`): каждая запись — состав на 100 единиц,
// умноженный на количество, до сотой «половина вверх», затем сумма. В целых сотых и
// десятых всё считается без погрешности: состав хранится до сотых, количество — до десятых.

/** Съеденное: `amount` единиц продукта с составом `per100` на 100 единиц. */
export function eatenOf(per100: Nutrients, amount: number): Nutrients {
  const tenths = Math.round(amount * 10)
  const part = (value: number) => Math.round((Math.round(value * 100) * tenths) / 1000) / 100
  return {
    kcal: part(per100.kcal),
    protein_g: part(per100.protein_g),
    fat_g: part(per100.fat_g),
    carbs_g: part(per100.carbs_g),
  }
}

/** Сумма съеденного — в целых сотых, чтобы день не копил ошибку дробей. */
export function totalOf(items: readonly Nutrients[]): Nutrients {
  const sum = { ...ZERO }
  for (const key of KEYS) {
    sum[key] = items.reduce((total, item) => total + Math.round(item[key] * 100), 0) / 100
  }
  return sum
}

function withTotals(day: Day): Day {
  const meals = day.meals.map((meal) => ({ ...meal, totals: totalOf(meal.entries) }))
  const intakes = day.water.intakes
  return {
    ...day,
    meals,
    totals: totalOf(meals.flatMap((meal) => meal.entries)),
    water: { intakes, total_ml: intakes.reduce((total, intake) => total + intake.amount_ml, 0) },
  }
}

const per100Of = (product: Product): Nutrients => ({
  kcal: product.kcal,
  protein_g: product.protein_g,
  fat_g: product.fat_g,
  carbs_g: product.carbs_g,
})

// --- Каталог -------------------------------------------------------------------------

async function catalog(): Promise<Product[]> {
  return (await copy.get<CatalogCopy>(DIARY_COPY.catalog))?.products ?? []
}

const byName = (a: Product, b: Product) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)

/**
 * Страница поиска по каталогу на телефоне — как у сервера: слова из `q` в названии в любом
 * порядке, без учёта регистра, по алфавиту; `next` — откуда продолжать.
 */
export async function searchCatalog(
  q: string,
  offset: number,
  kind: 'all' | 'products' | 'dishes' = 'all',
): Promise<{ items: Product[]; next?: number }> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const found = (await catalog()).filter(
    (product) =>
      (kind === 'all' || (kind === 'dishes') === (product.recipe != null)) &&
      words.every((word) => product.name.toLowerCase().includes(word)),
  )
  const next = offset + PAGE_SIZE
  return { items: found.slice(offset, next), next: found.length > next ? next : undefined }
}

export async function productFromCopy(id: string | null | undefined): Promise<Product | undefined> {
  return id ? (await catalog()).find((product) => product.id === id) : undefined
}

export async function productByBarcode(barcode: string): Promise<Product | undefined> {
  return (await catalog()).find((product) => product.barcode === barcode)
}

/** Продукт сохранили или нашли при связи — он сразу и в копии. */
export async function rememberProduct(product: Product): Promise<void> {
  await copy.update<CatalogCopy>(DIARY_COPY.catalog, (current) =>
    current
      ? {
          ...current,
          products: [...current.products.filter((item) => item.id !== product.id), product].sort(
            byName,
          ),
        }
      : undefined,
  )
}

export async function forgetProduct(id: string): Promise<void> {
  await copy.update<CatalogCopy>(DIARY_COPY.catalog, (current) =>
    current
      ? { ...current, products: current.products.filter((item) => item.id !== id) }
      : undefined,
  )
}

// --- Дни -----------------------------------------------------------------------------

async function storedDays(): Promise<Day[]> {
  return (await copy.list<Day>(DIARY_COPY.dayPrefix)).sort((a, b) =>
    b.local_date.localeCompare(a.local_date),
  )
}

/**
 * Будущий день, которого нет в копии: свои приёмы пищи из последнего сохранённого дня и
 * действующая цель. Внести туда можно и без сети — записей в нём ещё быть не может.
 */
async function blankDay(date: string): Promise<Day | undefined> {
  const [latest] = await storedDays()
  if (!latest) return undefined
  const goal = await copy.get<Goal | null>(DIARY_COPY.goal)
  return {
    local_date: date,
    meals: latest.meals
      .filter((meal) => !meal.archived)
      .map((meal) => ({ ...meal, entries: [], totals: ZERO })),
    totals: ZERO,
    water: { total_ml: 0, intakes: [] },
    goal: goal ?? null,
  }
}

/** День без сети: из копии, а будущий — пустым. Старый день вне копии — `undefined`. */
export async function dayOffline(date: string): Promise<Day | undefined> {
  return (
    (await copy.get<Day>(DIARY_COPY.day(date))) ?? (date > today() ? blankDay(date) : undefined)
  )
}

async function storeDay(day: Day): Promise<void> {
  await copy.put(DIARY_COPY.day(day.local_date), withTotals(day))
}

async function findEntry(id: string): Promise<{ day: Day; entry: Entry } | undefined> {
  for (const day of await storedDays()) {
    const entry = day.meals.flatMap((meal) => meal.entries).find((item) => item.id === id)
    if (entry) return { day, entry }
  }
  return undefined
}

/** Запись из копии по ключу — в каком бы дне она ни лежала. */
export async function entryFromCopy(id: string): Promise<Entry | undefined> {
  return (await findEntry(id))?.entry
}

const withoutEntry = (day: Day, id: string): Day => ({
  ...day,
  meals: day.meals.map((meal) => ({
    ...meal,
    entries: meal.entries.filter((entry) => entry.id !== id),
  })),
})

/** Запись так, как её вернул бы сервер: снимок продукта и съеденное по нему. */
async function entryOf(id: string, body: Schemas['FoodEntryIn'], old?: Entry): Promise<Entry> {
  // Тот же продукт — снимок прежний, как на сервере (I10); новый — снимается из каталога.
  const keep = old !== undefined && (body.product_id == null || body.product_id === old.product_id)
  const product = await productFromCopy(keep ? old.product_id : body.product_id)
  let per100: Nutrients
  if (product) per100 = per100Of(product)
  else if (keep && old.amount > 0) {
    // Продукта больше нет в каталоге: состав на 100 единиц восстанавливается из записи.
    per100 = Object.fromEntries(
      KEYS.map((key) => [key, (old[key] * 100) / old.amount]),
    ) as unknown as Nutrients
  } else throw new Error('product is not in the copy')

  let amount: number
  let portion: Portion | null = null
  if (body.portion) {
    const kind = body.portion.kind
    const size =
      keep && old.portion?.kind === kind
        ? old.portion.size
        : product
          ? sizesOf(product)[kind]
          : undefined
    if (size === undefined) throw new Error('portion is unknown')
    const count = Number(body.portion.count)
    amount = portionsAmount(count, size)
    portion = { kind, size, count }
  } else {
    amount = Number(body.amount)
  }
  return {
    id,
    local_date: body.local_date,
    meal_id: body.meal_id,
    product_id: keep ? old.product_id : body.product_id,
    product_name: keep ? old.product_name : product!.name,
    unit: keep ? old.unit : product!.unit,
    amount,
    portion,
    ...eatenOf(per100, amount),
  }
}

/** Внесённое без сети первым встаёт в «недавние» во всех подсказках. */
async function rememberUse(entry: Entry): Promise<void> {
  const product = await productFromCopy(entry.product_id)
  if (!product) return
  const used: Suggestion = { ...product, amount: entry.amount, portion: entry.portion }
  for (const key of await copy.keys(DIARY_COPY.suggestionsPrefix)) {
    await copy.update<Suggestions>(key, (lists) =>
      lists
        ? {
            ...lists,
            recent: [used, ...lists.recent.filter((item) => item.id !== used.id)].slice(
              0,
              SUGGESTIONS,
            ),
          }
        : undefined,
    )
  }
}

/** Изменения дневника в копии — те же, что делает сервер (ADR 0020). */
export const diaryCopy = {
  async saveEntry(id: string, body: Schemas['FoodEntryIn']): Promise<void> {
    const found = await findEntry(id)
    const entry = await entryOf(id, body, found?.entry)
    const sameDay = found?.day.local_date === body.local_date
    if (found && !sameDay) await storeDay(withoutEntry(found.day, id))
    const day = sameDay ? found.day : await dayOffline(body.local_date)
    if (!day) throw new Error('day is not in the copy')
    const place = (meal: DayMeal): DayMeal => {
      const here = meal.entries.some((item) => item.id === id)
      if (meal.id === body.meal_id)
        return {
          ...meal,
          entries: here
            ? meal.entries.map((item) => (item.id === id ? entry : item))
            : [...meal.entries, entry],
        }
      return here ? { ...meal, entries: meal.entries.filter((item) => item.id !== id) } : meal
    }
    if (!day.meals.some((meal) => meal.id === body.meal_id)) throw new Error('meal is unknown')
    await storeDay({ ...day, meals: day.meals.map(place) })
    if (!found) await rememberUse(entry)
  },

  async deleteEntry(id: string): Promise<void> {
    const found = await findEntry(id)
    if (found) await storeDay(withoutEntry(found.day, id))
  },

  async saveWater(id: string, body: Schemas['WaterIntakeIn']): Promise<void> {
    const day = await dayOffline(body.local_date)
    if (!day) throw new Error('day is not in the copy')
    const intake = { id, local_date: body.local_date, amount_ml: body.amount_ml }
    const known = day.water.intakes.some((item) => item.id === id)
    await storeDay({
      ...day,
      water: {
        ...day.water,
        intakes: known
          ? day.water.intakes.map((item) => (item.id === id ? intake : item))
          : [...day.water.intakes, intake],
      },
    })
  },

  async deleteWater(id: string): Promise<void> {
    for (const day of await storedDays()) {
      if (day.water.intakes.some((intake) => intake.id === id)) {
        await storeDay({
          ...day,
          water: { ...day.water, intakes: day.water.intakes.filter((intake) => intake.id !== id) },
        })
      }
    }
  },

  /** Последние дни, как их отдал сервер; дни старше копии из неё уходят. */
  async replaceDays(days: Day[]): Promise<void> {
    const oldest = days.at(-1)?.local_date
    for (const key of await copy.keys(DIARY_COPY.dayPrefix)) {
      if (oldest && key.slice(DIARY_COPY.dayPrefix.length) < oldest) await copy.remove(key)
    }
    for (const day of days) await copy.put(DIARY_COPY.day(day.local_date), day)
  },
}

/**
 * Как продукт вносили в прошлый раз — без сети, по дням копии; не нашлось там — по
 * сохранённым подсказкам. Тот же ответ, что `GET /api/diary/suggestions?product_id=…`.
 */
export async function historyOffline(productId: string, mealId: string): Promise<Suggestions> {
  const product = await productFromCopy(productId)
  if (!product) return { in_meal: [], recent: [], frequent: [] }
  const entries = (await storedDays()).flatMap((day) =>
    day.meals.flatMap((meal) => [...meal.entries].reverse()),
  )
  const asSuggestion = (entry: Entry): Suggestion => ({
    ...product,
    amount: entry.amount,
    portion: entry.portion,
  })
  const saved = await copy.get<Suggestions>(DIARY_COPY.suggestions(mealId))
  const savedHere = saved?.in_meal.find((item) => item.id === productId)
  const savedAnywhere = [...(saved?.recent ?? []), ...(saved?.frequent ?? [])].find(
    (item) => item.id === productId,
  )
  const inMeal = entries.find((entry) => entry.product_id === productId && entry.meal_id === mealId)
  const anywhere = entries.find((entry) => entry.product_id === productId)
  return {
    in_meal: inMeal ? [asSuggestion(inMeal)] : savedHere ? [savedHere] : [],
    recent: anywhere ? [asSuggestion(anywhere)] : savedAnywhere ? [savedAnywhere] : [],
    frequent: [],
  }
}
