import { describe, expect, it } from 'vitest'

import { shiftDays, today } from '@/lib/dates'
import {
  cottageCheese,
  dailyGoal,
  diaryDay,
  egg,
  foodEntry,
  kefir,
  meals,
  oatmeal,
  suggestionOf,
  waterIntake,
} from '@/test/fixtures'

import { copy } from './copy'
import {
  type CatalogCopy,
  DIARY_COPY,
  dayOffline,
  diaryCopy,
  eatenOf,
  historyOffline,
  searchCatalog,
  totalOf,
} from './diary'

const dish = {
  ...oatmeal,
  id: '0199b7a0-0000-7000-8000-0000000000d1',
  name: 'Каша овсяная',
  recipe: { ingredients: [], output_g: 300 },
}

async function seedCatalog(...products: CatalogCopy['products']) {
  await copy.put(DIARY_COPY.catalog, { etag: '"1"', products } satisfies CatalogCopy)
}

describe('итоги по правилам сервера', () => {
  it('округляет каждую запись до сотых «половина вверх», в целых, без погрешности дробей', () => {
    // 10,01 × 50 / 100 = 5,005: в дробях получилось бы 5,00, сервер даёт 5,01.
    expect(eatenOf({ kcal: 352, protein_g: 10.01, fat_g: 0.03, carbs_g: 61.8 }, 50)).toEqual({
      kcal: 176,
      protein_g: 5.01,
      fat_g: 0.02,
      carbs_g: 30.9,
    })
    expect(eatenOf(cottageCheese, 150).kcal).toBe(181.5)
  })

  it('складывает записи в целых сотых', () => {
    const tenth = { kcal: 0.1, protein_g: 0.1, fat_g: 0.1, carbs_g: 0.1 }
    const fifth = { kcal: 0.2, protein_g: 0.2, fat_g: 0.2, carbs_g: 0.2 }
    expect(totalOf([tenth, fifth]).kcal).toBe(0.3)
  })
})

describe('поиск по каталогу на телефоне', () => {
  it('находит слова в любом порядке и без учёта регистра, страницами по 20', async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...kefir,
      id: `0199b7a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
      name: `Кефир ${String(index).padStart(2, '0')}`,
    }))
    await seedCatalog(cottageCheese, oatmeal, dish, ...many)

    expect((await searchCatalog('5 % ТВОРОГ', 0)).items).toEqual([cottageCheese])
    expect((await searchCatalog('', 0, 'dishes')).items).toEqual([dish])
    expect((await searchCatalog('овс', 0, 'products')).items).toEqual([oatmeal])
    const first = await searchCatalog('кефир', 0)
    expect(first.items).toHaveLength(20)
    expect(first.next).toBe(20)
    const second = await searchCatalog('кефир', 20)
    expect(second.items).toHaveLength(5)
    expect(second.next).toBeUndefined()
  })
})

describe('день без сети', () => {
  it('будущий день — пустым со своими приёмами пищи и целью, старый вне копии — нет', async () => {
    await copy.put(DIARY_COPY.day(today()), diaryDay(today(), [foodEntry(egg, 120)]))
    await copy.put(DIARY_COPY.goal, dailyGoal)
    const tomorrow = shiftDays(today(), 1)

    const blank = await dayOffline(tomorrow)

    expect(blank).toMatchObject({ local_date: tomorrow, goal: dailyGoal, totals: { kcal: 0 } })
    expect(blank?.meals.map((meal) => [meal.id, meal.entries.length])).toEqual(
      Object.values(meals).map((meal) => [meal.id, 0]),
    )
    expect(await dayOffline(shiftDays(today(), -30))).toBeUndefined()
  })
})

describe('изменения дневника в копии', () => {
  const date = today()
  const id = '0199b7a0-0000-7000-8000-0000000000e1'

  it('новая запись порциями: количество, съеденное, итоги и «недавние»', async () => {
    await seedCatalog(egg)
    await copy.put(DIARY_COPY.day(date), diaryDay(date, [foodEntry(cottageCheese, 100)]))
    await copy.put(DIARY_COPY.suggestions(meals.breakfast.id), {
      in_meal: [],
      recent: [suggestionOf(cottageCheese, 100)],
      frequent: [],
    })

    await diaryCopy.saveEntry(id, {
      local_date: date,
      meal_id: meals.breakfast.id,
      product_id: egg.id,
      portion: { kind: 'serving', count: 2 },
    })

    const day = (await copy.get<ReturnType<typeof diaryDay>>(DIARY_COPY.day(date)))!
    const added = day.meals[0]!.entries.at(-1)!
    expect(added).toMatchObject({
      id,
      amount: 120,
      unit: 'g',
      product_name: egg.name,
      portion: { kind: 'serving', size: 60, count: 2 },
      kcal: 188.4,
      protein_g: 15.24,
    })
    expect(day.totals.kcal).toBe(309.4)
    expect(day.meals[0]!.totals.kcal).toBe(309.4)
    const lists = await copy.get<{ recent: { id: string }[] }>(
      DIARY_COPY.suggestions(meals.breakfast.id),
    )
    expect(lists?.recent.map((item) => item.id)).toEqual([egg.id, cottageCheese.id])
  })

  it('правка того же продукта оставляет снимок, удаление убирает запись из итога', async () => {
    const old = { ...foodEntry(cottageCheese, 100), id, product_name: 'Творог старый' }
    await seedCatalog(cottageCheese)
    await copy.put(DIARY_COPY.day(date), diaryDay(date, [old]))

    await diaryCopy.saveEntry(id, {
      local_date: date,
      meal_id: meals.breakfast.id,
      product_id: cottageCheese.id,
      amount: 200,
    })
    const edited = (await copy.get<ReturnType<typeof diaryDay>>(DIARY_COPY.day(date)))!
    expect(edited.meals[0]!.entries).toMatchObject([
      { id, amount: 200, product_name: 'Творог старый', kcal: 242 },
    ])

    await diaryCopy.deleteEntry(id)
    const emptied = (await copy.get<ReturnType<typeof diaryDay>>(DIARY_COPY.day(date)))!
    expect(emptied.meals[0]!.entries).toEqual([])
    expect(emptied.totals.kcal).toBe(0)
  })

  it('порция воды прибавляется к выпитому и убирается из него', async () => {
    await copy.put(DIARY_COPY.day(date), diaryDay(date, [], null, undefined, [waterIntake(400)]))

    await diaryCopy.saveWater(id, { local_date: date, amount_ml: 250 })
    expect((await dayOffline(date))?.water.total_ml).toBe(650)

    await diaryCopy.deleteWater(id)
    expect((await dayOffline(date))?.water.total_ml).toBe(400)
  })

  it('история продукта: как вносили в этот приём и вообще', async () => {
    await seedCatalog(egg)
    const lunch = { ...foodEntry(egg, 180), meal_id: meals.lunch.id }
    const breakfast = foodEntry(egg, 60, {
      portion: { kind: 'serving', size: 60, count: 1 },
    })
    await copy.put(DIARY_COPY.day(date), diaryDay(date, [breakfast, lunch]))

    const history = await historyOffline(egg.id, meals.lunch.id)

    expect(history.in_meal).toMatchObject([{ id: egg.id, amount: 180 }])
    expect(history.recent).toHaveLength(1)
  })
})
