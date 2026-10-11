import { z } from 'zod'

import type { Dictionary } from '@/i18n/ru'
import { parseDecimal } from '@/lib/numbers'

export type ValidationKey = `validation.${keyof Dictionary['validation']}`

/** Сообщение схемы zod — это ключ словаря; функция нужна только ради проверки ключа типами. */
export const message = (key: ValidationKey): ValidationKey => key

/** Поле с числом в диапазоне [min, max]; запятая и точка равноправны. */
export function numberIn(min: number, max: number, key: ValidationKey) {
  return z.string().refine((text) => {
    const value = parseDecimal(text)
    return value !== null && value >= min && value <= max
  }, message(key))
}

/** Число из проверенного поля, округлённое до точности, которую хранит сервер. */
export function numberOf(text: string, digits: number): number {
  const factor = 10 ** digits
  return Math.round((parseDecimal(text) ?? 0) * factor) / factor
}
