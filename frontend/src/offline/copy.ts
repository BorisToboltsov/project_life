import { db } from './db'

// Копия только помогает: если хранилище браузера недоступно (бывает в приватном режиме),
// экраны со связью работают как без неё — чтение отдаёт «нет в копии», запись пропускается.
async function quietly<T>(action: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await action()
  } catch {
    return fallback
  }
}

/**
 * Копия ответов сервера на устройстве — то, что экраны покажут без сети (ADR 0020). Ключ —
 * имя ответа: `exercises`, `workouts`, `workout:<ключ>`. Изменения из очереди вносятся в
 * копию сразу, поэтому до отправки экран видит их на своих местах.
 */
export const copy = {
  get<T>(key: string): Promise<T | undefined> {
    return quietly(async () => (await db.copy.get(key))?.value as T | undefined, undefined)
  },

  put(key: string, value: unknown): Promise<void> {
    return quietly(async () => void (await db.copy.put({ key, value })), undefined)
  },

  remove(key: string): Promise<void> {
    return quietly(() => db.copy.delete(key), undefined)
  },

  /** Меняет запись копии; `undefined` из `change` оставляет её как есть. */
  update<T>(key: string, change: (value: T | undefined) => T | undefined): Promise<void> {
    return quietly(
      () =>
        db.transaction('rw', db.copy, async () => {
          const next = change(await copy.get<T>(key))
          if (next !== undefined) await copy.put(key, next)
        }),
      undefined,
    )
  },

  /** Все записи, чьи ключи начинаются с `prefix`. */
  list<T>(prefix: string): Promise<T[]> {
    return quietly(async () => {
      const rows = await db.copy.where('key').startsWith(prefix).toArray()
      return rows.map((row) => row.value as T)
    }, [])
  },

  keys(prefix: string): Promise<string[]> {
    return quietly(
      async () => (await db.copy.where('key').startsWith(prefix).primaryKeys()) as string[],
      [],
    )
  },
}
