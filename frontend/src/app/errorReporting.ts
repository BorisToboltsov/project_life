// Сбор ошибок (ADR 0006): сбой в приложении уходит на сервер отчётом без данных
// пользователя — тип исключения, шаблон маршрута, кадры стека и версия (инвариант I9).

import { api, type Schemas } from '@/api/client'
import { session } from '@/auth/session'
import { parseStack } from '@/lib/stack'

type Report = Schemas['ErrorReportIn']

/** Роутер — в той мере, в какой он нужен здесь: по нему определяется текущий экран. */
interface Router {
  state: { matches: { fullPath: string }[] }
}

/** Столько разных ошибок уходит на сервер за одно открытие приложения: защита от цикла. */
const LIMIT = 10

const KIND = /^[A-Za-z_$][A-Za-z0-9_$.]{0,79}$/
// Сегменты без цифр, параметр — `$имя`: настоящий адрес с идентификатором сюда не пройдёт.
const ROUTE = /^\/(\$?[A-Za-z_-]+(\/\$?[A-Za-z_-]+)*)?$/

const sent = new Set<string>()

/** Шаблон маршрута открытого экрана (`/measurements/$metric`), а не его адрес. */
export function routeTemplate(router: Router): string | null {
  const route = router.state.matches.at(-1)?.fullPath
  return route !== undefined && route.length <= 120 && ROUTE.test(route) ? route : null
}

function kindOf(error: unknown): string {
  if (!(error instanceof Error)) return 'NonError'
  return KIND.test(error.name) ? error.name : 'Error'
}

/** Отправляет отчёт о сбое. Сама никогда не бросает: сбор ошибок не должен их добавлять. */
export function reportError(error: unknown, route: string | null): void {
  // Эндпоинт закрыт для гостей; до входа отчёты не собираются.
  if (session.getState().status !== 'authenticated') return
  const report: Report = {
    kind: kindOf(error),
    route,
    frames: error instanceof Error ? parseStack(error.stack ?? '', window.location.origin) : [],
    version: import.meta.env.APP_VERSION,
  }
  const key = JSON.stringify(report)
  if (sent.has(key) || sent.size >= LIMIT) return
  sent.add(key)
  api.POST('/api/errors', { body: report }).catch(() => {})
}

/**
 * Обработчик `onCaughtError` для корня React. Сбой при отрисовке экрана перехватывает
 * граница ошибок роутера, и до window он не доходит — React сообщает о нём сюда.
 */
export function caughtErrorHandler(router: Router): (error: unknown) => void {
  return (error) => {
    // Свой обработчик заменяет стандартный, а тот печатал ошибку в консоль.
    console.error(error)
    reportError(error, routeTemplate(router))
  }
}

/**
 * Ловит сбои вне отрисовки экранов — в обработчиках событий и в промисах. Возвращает
 * функцию отключения.
 */
export function installErrorReporting(router: Router): () => void {
  const onError = (event: ErrorEvent) => {
    // Без исключения приходит сбой чужого скрипта: о нём нечего сообщить.
    if (event.error != null) reportError(event.error, routeTemplate(router))
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, routeTemplate(router))
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    sent.clear()
  }
}
