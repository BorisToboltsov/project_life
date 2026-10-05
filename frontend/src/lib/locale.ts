/**
 * Локаль форматирования для языка интерфейса. Английский — британский: в американском
 * месяц стоит перед днём, а время 12-часовое.
 */
const LOCALES: Record<string, string> = { ru: 'ru-RU', en: 'en-GB' }

export function intlLocale(language: string): string {
  return LOCALES[language] ?? language
}
