// Русский словарь — эталон формы: остальные языки обязаны повторять его ключи (см. en.ts).
export const ru = {
  app: {
    tagline: 'Питание, тренировки и здоровье',
  },
  server: {
    checking: 'Проверяем сервер…',
    ok: 'Сервер доступен, версия {{version}}',
    down: 'Сервер недоступен',
  },
  language: {
    label: 'Язык',
  },
}

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> }

export type Dictionary = Shape<typeof ru>
