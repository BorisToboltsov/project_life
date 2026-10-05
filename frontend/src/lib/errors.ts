import type { Schemas } from '@/api/client'
import { ru } from '@/i18n/ru'

export type ErrorKey = `errors.${keyof typeof ru.errors}`

function isKnownCode(code: unknown): code is Schemas['ErrorCode'] {
  return typeof code === 'string' && code in ru.errors
}

/**
 * Ключ словаря для ошибки API. Бэкенд присылает код, текст подбирается здесь:
 * `error` — тело ошибочного ответа, `undefined` — запрос не дошёл до сервера.
 */
export function errorKey(error: unknown): ErrorKey {
  if (error === undefined) return 'errors.network'
  const detail = (error as { detail?: unknown } | null)?.detail
  return isKnownCode(detail) ? `errors.${detail}` : 'errors.unknown'
}

/** Обёртка над вызовом API: сетевой сбой превращается в тот же вид ошибки, что и отказ. */
export async function attempt<T>(
  call: () => Promise<{ data?: T; error?: unknown }>,
): Promise<{ data: T; failure?: undefined } | { data?: undefined; failure: ErrorKey }> {
  try {
    const { data, error } = await call()
    if (error !== undefined) return { failure: errorKey(error) }
    return { data: data as T }
  } catch {
    return { failure: 'errors.network' }
  }
}
