// Порции и упаковки (ADR 0013): продукт вносят в его единицах, порциями или упаковками.
// Количество в единицах продукта считает сервер; здесь — пересчёт для поля ввода.

import type { Schemas } from '@/api/client'

export type PortionKind = Schemas['PortionKind']
/** В чём введено количество: в единицах продукта или в одной из его мер. */
export type AmountMode = 'unit' | PortionKind

export const PORTION_KINDS: PortionKind[] = ['serving', 'package']
export const AMOUNT_MODES: AmountMode[] = ['unit', ...PORTION_KINDS]

/** Размеры мер продукта в его единицах; какой меры у продукта нет — той нет и здесь. */
export type PortionSizes = Partial<Record<PortionKind, number>>

export function sizesOf(product: {
  serving_size: number | null
  package_size: number | null
}): PortionSizes {
  return {
    ...(product.serving_size != null && { serving: product.serving_size }),
    ...(product.package_size != null && { package: product.package_size }),
  }
}

/** Границы количества в единицах продукта и числа порций — те же, что на сервере. */
export const AMOUNT_MIN = 0.1
export const AMOUNT_MAX = 5000
export const COUNT_MIN = 0.01
export const COUNT_MAX = 100

/**
 * Сколько единиц продукта в `count` порциях размера `size` — до десятой, как считает
 * сервер. Число порций хранится до сотой, размер — до десятой: в целых они перемножаются
 * без погрешности.
 */
export function portionsAmount(count: number, size: number): number {
  return Math.round((Math.round(count * 100) * Math.round(size * 10)) / 100) / 10
}
