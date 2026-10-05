import type { Dictionary } from '@/i18n/ru'

export type ValidationKey = `validation.${keyof Dictionary['validation']}`

/** Сообщение схемы zod — это ключ словаря; функция нужна только ради проверки ключа типами. */
export const message = (key: ValidationKey): ValidationKey => key
