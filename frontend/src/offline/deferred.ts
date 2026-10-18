import { api, type Schemas } from '@/api/client'

import { type Deferred, type DeferredAmount, db } from './db'
import { rememberProduct } from './diary'
import { offlineState } from './store'

type Product = Schemas['ProductOut']

/**
 * Записи по незнакомым штрихкодам (ADR 0020): без сети или когда Open Food Facts не
 * отвечает, штрихкод записывается с количеством, а продукт ищется позже — сам, как только
 * вернулась связь. Найденный предлагается человеку; без его согласия в дневник он не идёт.
 */
export const deferredBarcodes = {
  async add(item: {
    id: string
    barcode: string
    localDate: string
    mealId: string
    amount: DeferredAmount
  }): Promise<void> {
    await db.deferred.put({ ...item, status: 'waiting', createdAt: Date.now() })
    await offlineState.reload()
  },

  async remove(id: string): Promise<void> {
    await db.deferred.delete(id)
    await offlineState.reload()
  },
}

/**
 * Запись дневника для найденного продукта: упаковками — если размер упаковки известен,
 * иначе `undefined`, и количество человек укажет сам; в граммах или миллилитрах — как есть.
 */
export function entryBodyOf(item: Deferred, product: Product): Schemas['FoodEntryIn'] | undefined {
  const where = { local_date: item.localDate, meal_id: item.mealId, product_id: product.id }
  if ('units' in item.amount) return { ...where, amount: item.amount.units }
  if (product.package_size == null) return undefined
  return { ...where, portion: { kind: 'package', count: item.amount.packages } }
}

/**
 * Ищет ждущие штрихкоды тем же запросом, что и сканер, — по разу на штрихкод. Найденный
 * продукт сервер кладёт в каталог, он попадает и в копию; `unavailable` — штрихкод ждёт
 * следующей попытки. `true` — что-то нашлось или выяснилось.
 */
export async function resolveDeferred(): Promise<boolean> {
  const waiting = (await db.deferred.toArray()).filter((item) => item.status === 'waiting')
  let changed = false
  for (const barcode of new Set(waiting.map((item) => item.barcode))) {
    let answer
    try {
      answer = await api.POST('/api/products/lookup', { body: { barcode } })
    } catch {
      offlineState.setOnline(false)
      break
    }
    // Предел запросов или сбой сервера: остальное — в следующий раз.
    if (!answer.data) break
    const { status, product, draft } = answer.data
    if (status === 'unavailable') continue
    const same = waiting.filter((item) => item.barcode === barcode)
    if (status === 'found' && product) {
      await rememberProduct(product)
      await db.deferred.bulkPut(
        same.map((item) => ({ ...item, status: 'found' as const, productId: product.id })),
      )
    } else {
      const missing = {
        status: status === 'draft' ? ('draft' as const) : ('not_found' as const),
        draft: draft ?? null,
      }
      await db.deferred.bulkPut(
        same.map((item) => ({ ...item, status: 'missing' as const, missing })),
      )
    }
    changed = true
  }
  await offlineState.reload()
  return changed
}
