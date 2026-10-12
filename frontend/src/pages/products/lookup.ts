import type { QueryClient } from '@tanstack/react-query'

import {
  type BarcodeLookup,
  lookupBarcode,
  type Product,
  type ProductDraft,
  productKey,
  PRODUCTS_KEY,
} from '@/api/nutrition'
import type { ErrorKey } from '@/lib/errors'

/** Продукта в каталоге нет: чем кончился поиск и что о продукте известно. */
export interface Missing {
  status: Exclude<BarcodeLookup['status'], 'found'>
  barcode: string
  draft?: Partial<ProductDraft> | null
}

export type Looked = { product: Product } | { missing: Missing } | { failure: ErrorKey }

/**
 * Продукт по штрихкоду — из каталога или из Open Food Facts (ADR 0009). В каталоге он мог
 * появиться только что, поэтому найденный кладётся в кэш, а поиски перечитываются.
 */
export async function lookUp(queryClient: QueryClient, barcode: string): Promise<Looked> {
  const result = await lookupBarcode(barcode)
  if (result.failure) return { failure: result.failure }
  const { status, product, draft } = result.data
  if (status !== 'found' || !product) {
    return { missing: { status: status === 'found' ? 'not_found' : status, barcode, draft } }
  }
  queryClient.setQueryData(productKey(product.id), product)
  void queryClient.invalidateQueries({ queryKey: [...PRODUCTS_KEY, 'search'] })
  void queryClient.invalidateQueries({ queryKey: [...PRODUCTS_KEY, 'external'] })
  return { product }
}
