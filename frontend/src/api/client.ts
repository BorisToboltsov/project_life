import createClient from 'openapi-fetch'

import type { paths } from './schema'

// Типы путей и ответов генерируются из OpenAPI бэкенда: `make api-client`.
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // fetch берётся в момент вызова, а не создания клиента — иначе его не подменить в тестах.
  fetch: (request) => globalThis.fetch(request),
})
