/** Токен одноразовой ссылки лежит во фрагменте адреса и на сервер с запросом страницы не уходит. */
export function tokenFromHash(): string {
  return window.location.hash.slice(1)
}
