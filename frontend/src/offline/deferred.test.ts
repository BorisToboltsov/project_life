import { describe, expect, it, vi } from 'vitest'

import { callsTo, json, mockApi } from '@/test/api'
import { cottageCheese, egg, meals } from '@/test/fixtures'

import { copy } from './copy'
import { type Deferred, db } from './db'
import { deferredBarcodes, entryBodyOf, resolveDeferred } from './deferred'
import { type CatalogCopy, DIARY_COPY } from './diary'
import { offlineState } from './store'

const date = '2026-10-18'
const found = '4601000000016'
const absent = '4607000000017'
const silent = '4603000000015'

function item(id: string, barcode: string, amount: Deferred['amount']): Deferred {
  return {
    id,
    barcode,
    localDate: date,
    mealId: meals.lunch.id,
    amount,
    status: 'found',
    productId: egg.id,
    createdAt: 1,
  }
}

describe('запись для найденного продукта', () => {
  it('упаковками — если размер упаковки известен, иначе количество укажет человек', () => {
    const packages = item('a', found, { packages: 2 })

    expect(entryBodyOf(packages, egg)).toEqual({
      local_date: date,
      meal_id: meals.lunch.id,
      product_id: egg.id,
      portion: { kind: 'package', count: 2 },
    })
    expect(entryBodyOf(packages, cottageCheese)).toBeUndefined()
    expect(entryBodyOf(item('b', found, { units: 150 }), cottageCheese)).toMatchObject({
      amount: 150,
    })
  })
})

describe('поиск отложенных штрихкодов', () => {
  async function seed() {
    await copy.put(DIARY_COPY.catalog, { etag: null, products: [] } satisfies CatalogCopy)
    for (const [id, barcode] of [
      ['0199b7a0-0000-7000-8000-0000000000f1', found],
      ['0199b7a0-0000-7000-8000-0000000000f2', found],
      ['0199b7a0-0000-7000-8000-0000000000f3', absent],
      ['0199b7a0-0000-7000-8000-0000000000f4', silent],
    ] as const) {
      await deferredBarcodes.add({
        id,
        barcode,
        localDate: date,
        mealId: meals.lunch.id,
        amount: { packages: 1 },
      })
    }
  }

  it('спрашивает каждый штрихкод один раз; найденное ждёт согласия, ненайденное — продукта', async () => {
    await seed()
    const product = { ...egg, barcode: found }
    const calls = mockApi({
      'POST /api/products/lookup': (call) => {
        const { barcode } = call.body as { barcode: string }
        if (barcode === found) return json(200, { status: 'found', barcode, product })(call)
        if (barcode === absent) return json(200, { status: 'not_found', barcode })(call)
        return json(200, { status: 'unavailable', barcode })(call)
      },
    })

    expect(await resolveDeferred()).toBe(true)

    expect(callsTo(calls, 'POST /api/products/lookup')).toHaveLength(3)
    const of = (barcode: string) =>
      offlineState.get().deferred.filter((value) => value.barcode === barcode)
    expect(of(found).map((value) => [value.status, value.productId])).toEqual([
      ['found', egg.id],
      ['found', egg.id],
    ])
    expect(of(absent)[0]).toMatchObject({
      status: 'missing',
      missing: { status: 'not_found', draft: null },
    })
    // Open Food Facts не ответил — штрихкод ждёт следующей попытки.
    expect(of(silent)[0]?.status).toBe('waiting')
    const catalog = await copy.get<CatalogCopy>(DIARY_COPY.catalog)
    expect(catalog?.products.map((value) => value.id)).toEqual([egg.id])
  })

  it('без связи всё остаётся ждать', async () => {
    await seed()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    expect(await resolveDeferred()).toBe(false)

    expect(offlineState.get().online).toBe(false)
    expect((await db.deferred.toArray()).every((value) => value.status === 'waiting')).toBe(true)
  })
})
