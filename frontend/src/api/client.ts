import createClient, { type Middleware } from 'openapi-fetch'

import type { components, paths } from './schema'

export type Schemas = components['schemas']

interface AuthHooks {
  /** Текущий access-токен или null, если пользователь не вошёл. */
  getToken: () => string | null
  /** Обновляет сессию по refresh-cookie; true — токен получен. */
  refresh: () => Promise<boolean>
}

let auth: AuthHooks = { getToken: () => null, refresh: () => Promise.resolve(false) }

/** Сессия подключается сюда сама (см. auth/session.ts): клиент о ней ничего не знает. */
export function configureAuth(hooks: AuthHooks): void {
  auth = hooks
}

// Копии запросов для повтора после обновления токена: тело исходного запроса уже прочитано.
const pending = new Map<string, Request>()

const authMiddleware: Middleware = {
  onRequest({ request, id, schemaPath }) {
    const token = auth.getToken()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    // Эндпоинты авторизации не повторяем: их 401 — это ответ по существу.
    if (!schemaPath.startsWith('/api/auth/')) pending.set(id, request.clone())
    return request
  },
  async onResponse({ response, id }) {
    const retry = pending.get(id)
    pending.delete(id)
    if (response.status !== 401 || !retry) return response
    if (!(await auth.refresh())) return response
    retry.headers.set('Authorization', `Bearer ${auth.getToken()}`)
    return globalThis.fetch(retry)
  },
  onError({ id }) {
    pending.delete(id)
  },
}

// Типы путей и ответов генерируются из OpenAPI бэкенда: `make api-client`.
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // fetch берётся в момент вызова, а не создания клиента — иначе его не подменить в тестах.
  fetch: (request) => globalThis.fetch(request),
})

api.use(authMiddleware)
