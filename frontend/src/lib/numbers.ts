import { intlLocale } from './locale'

/**
 * Число из текста поля ввода. Десятичный разделитель — запятая или точка: русская
 * клавиатура ставит запятую, английская — точку. Не число — `null`.
 */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  return Number(normalized)
}

/** Число в записи языка интерфейса: «72,4» по-русски, «72.4» по-английски. */
export function formatNumber(value: number, language: string, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(intlLocale(language), { maximumFractionDigits }).format(value)
}

/** Число лет словами языка интерфейса: «36 лет», «31 год», «36 years». */
export function formatYears(value: number, language: string): string {
  return new Intl.NumberFormat(intlLocale(language), {
    style: 'unit',
    unit: 'year',
    unitDisplay: 'long',
  }).format(value)
}

/** Изменение со знаком: «+0,4», «-0,4», «0». */
export function formatDelta(value: number, language: string): string {
  return new Intl.NumberFormat(intlLocale(language), {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(value)
}
