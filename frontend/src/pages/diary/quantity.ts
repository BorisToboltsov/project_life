import { z } from 'zod'

import type { Schemas } from '@/api/client'
import { message, numberOf, type ValidationKey } from '@/components/form/validation'
import { parseDecimal } from '@/lib/numbers'
import {
  AMOUNT_MAX,
  AMOUNT_MIN,
  AMOUNT_MODES,
  type AmountMode,
  COUNT_MAX,
  COUNT_MIN,
  type PortionKind,
  portionsAmount,
  type PortionSizes,
} from '@/lib/portions'

/** Количество продукта, как оно набрано в форме: мера и число в ней. */
export interface Quantity {
  mode: AmountMode
  amount: string
}

/** Поля количества для схемы формы; проверяет их `checkQuantity`. */
export const quantityShape = { mode: z.enum(AMOUNT_MODES), amount: z.string() }

/**
 * Набранное количество в единицах продукта; `null` — в поле не число или такой меры у
 * продукта нет.
 */
export function unitsOf({ mode, amount }: Quantity, sizes: PortionSizes): number | null {
  const value = parseDecimal(amount)
  if (value === null) return null
  if (mode === 'unit') return value
  const size = sizes[mode]
  return size === undefined ? null : portionsAmount(value, size)
}

const within = (value: number | null, min: number, max: number) =>
  value !== null && value >= min && value <= max

/** Что не так с количеством — ключ сообщения; `undefined` — всё в порядке. */
function problem(quantity: Quantity, sizes: PortionSizes): ValidationKey | undefined {
  if (quantity.mode === 'unit') {
    return within(unitsOf(quantity, sizes), AMOUNT_MIN, AMOUNT_MAX)
      ? undefined
      : 'validation.amountRange'
  }
  if (!within(parseDecimal(quantity.amount), COUNT_MIN, COUNT_MAX)) {
    return 'validation.portionCountRange'
  }
  // Сто упаковок по килограмму — число порций в порядке, а количество нет.
  return within(unitsOf(quantity, sizes), AMOUNT_MIN, AMOUNT_MAX)
    ? undefined
    : 'validation.portionsAmount'
}

/** Проверка количества для `superRefine`: ошибка — у поля с числом. */
export function checkQuantity(sizes: PortionSizes) {
  return (values: Quantity, context: z.RefinementCtx) => {
    const key = problem(values, sizes)
    if (key) context.addIssue({ code: 'custom', path: ['amount'], message: message(key) })
  }
}

/** Количество продукта с такими мерами. */
export function quantitySchema(sizes: PortionSizes) {
  return z.object(quantityShape).superRefine(checkQuantity(sizes))
}

/** Количество для запроса: в единицах продукта либо порциями — тогда единицы считает сервер. */
export function howMuch({
  mode,
  amount,
}: Quantity): Pick<Schemas['FoodEntryIn'], 'amount' | 'portion'> {
  return mode === 'unit'
    ? { amount: numberOf(amount, 1) }
    : { portion: { kind: mode, count: numberOf(amount, 2) } }
}

/** Количество в том виде, в каком его хранит запись: единицы продукта и — если внесли ими — порции. */
export interface Entered {
  amount: number
  portion: { kind: PortionKind; count: number } | null
}

/** Набранное количество так, как оно ляжет в запись. */
export function entered(quantity: Quantity, sizes: PortionSizes): Entered {
  const { amount, portion } = howMuch(quantity)
  return portion
    ? {
        amount: unitsOf(quantity, sizes) ?? 0,
        portion: { kind: portion.kind, count: Number(portion.count) },
      }
    : { amount: Number(amount), portion: null }
}

/** Количество по умолчанию для продукта без порции, который человек ещё не вносил. */
const DEFAULT_AMOUNT = 100

/** С чего начинается поле у продукта, который человек ещё не вносил: с одной порции. */
export function firstQuantity(product: { serving_size: number | null }): Quantity {
  return product.serving_size == null
    ? { mode: 'unit', amount: String(DEFAULT_AMOUNT) }
    : { mode: 'serving', amount: '1' }
}

/** Количество записи или подсказки — так, как его внесли. */
export function quantityOf(item: Entered): Quantity {
  return item.portion
    ? { mode: item.portion.kind, amount: String(item.portion.count) }
    : { mode: 'unit', amount: String(item.amount) }
}

/**
 * Число в поле после смены меры на `to`. То же количество в новой мере, если оно в ней
 * выражается ровно: «120 г» — это «2 порции» по 60 г, и наоборот. Не выражается — набранное
 * остаётся как есть, а не тронутая человеком подсказка становится одной порцией.
 */
export function switched(
  quantity: Quantity,
  to: AmountMode,
  sizes: PortionSizes,
  typed: boolean,
): string {
  const units = unitsOf(quantity, sizes)
  if (to === 'unit') return units === null ? quantity.amount : String(units)
  const size = sizes[to]
  if (units !== null && size !== undefined) {
    const count = Math.round((units / size) * 100) / 100
    if (within(count, COUNT_MIN, COUNT_MAX) && portionsAmount(count, size) === units) {
      return String(count)
    }
  }
  return typed ? quantity.amount : '1'
}
