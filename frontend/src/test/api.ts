import { vi } from 'vitest'

export interface ApiCall {
  method: string
  path: string
  /** Параметры строки запроса. */
  query: Record<string, string>
  body: unknown
  authorization: string | null
}

type Route = (call: ApiCall) => Response

export function json(status: number, body?: unknown): Route {
  return () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
}

/** Ответы по очереди: первый вызов получает первый ответ, последний ответ повторяется. */
export function sequence(...routes: Route[]): Route {
  let index = 0
  return (call) => routes[Math.min(index++, routes.length - 1)](call)
}

/**
 * Подменяет fetch таблицей «МЕТОД путь → ответ» и возвращает журнал вызовов. Путь может
 * кончаться на `/*` — тогда он подходит к любому продолжению (идентификатор записи).
 * Запрос мимо таблицы получает 404 — тест увидит его как отказ, а не как зависание.
 */
export function mockApi(routes: Record<string, Route>): ApiCall[] {
  const calls: ApiCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      const text = await request.text()
      const url = new URL(request.url)
      const call: ApiCall = {
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: text ? JSON.parse(text) : undefined,
        authorization: request.headers.get('Authorization'),
      }
      calls.push(call)
      const key = `${call.method} ${call.path}`
      const wildcard = Object.keys(routes).find(
        (pattern) => pattern.endsWith('/*') && key.startsWith(pattern.slice(0, -1)),
      )
      const route = routes[key] ?? (wildcard ? routes[wildcard] : undefined)
      return route ? route(call) : new Response(null, { status: 404 })
    }),
  )
  return calls
}

export function callsTo(calls: ApiCall[], route: string): ApiCall[] {
  const prefix = route.endsWith('/*') ? route.slice(0, -1) : null
  return calls.filter((call) => {
    const key = `${call.method} ${call.path}`
    return prefix ? key.startsWith(prefix) : key === route
  })
}
