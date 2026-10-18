import type { Schemas } from '@/api/client'

import { copy } from './copy'
import { db } from './db'
import { offlineState } from './store'

type User = Schemas['UserOut']

const OWNER = 'owner'
const USER = 'me'

/** Копия читается из базы, когда модуль подключён: до этого экраны её не видят. */
const loaded = offlineState.reload().catch(() => undefined)

// Стирание копии обгоняет начатое присвоение: выход посреди входа не оставит копию вышедшего.
let erasures = 0

/**
 * Копия и очередь принадлежат одному пользователю (ADR 0020): вход другого стирает их, выход —
 * тоже. Сессия сообщает сюда, кто вошёл, и спрашивает, кого показать без сети.
 */
export const offlineSession = {
  /** Пользователь вошёл или обновил профиль: копия теперь его. */
  async claim(user: User): Promise<void> {
    let started = erasures
    await loaded
    const owner = await copy.get<string>(OWNER)
    if (started !== erasures) return
    if (owner !== undefined && owner !== user.id) {
      await offlineSession.erase()
      started = erasures
    }
    // Проверка внутри записи: транзакции копии идут по одной, стирание не вклинится.
    await db.transaction('rw', db.copy, async () => {
      if (started !== erasures) return
      await copy.put(OWNER, user.id)
      await copy.put(USER, user)
    })
  },

  /** Кто входил на этом устройстве, если от него осталась копия. */
  async cachedUser(): Promise<User | undefined> {
    await loaded
    const [owner, user] = await Promise.all([copy.get<string>(OWNER), copy.get<User>(USER)])
    return user && user.id === owner ? user : undefined
  },

  /** Стирает с устройства копию, очередь, отказы и отложенные штрихкоды. */
  async erase(): Promise<void> {
    erasures++
    await db.transaction('rw', db.copy, db.queue, db.rejected, db.deferred, async () => {
      await Promise.all([
        db.copy.clear(),
        db.queue.clear(),
        db.rejected.clear(),
        db.deferred.clear(),
      ])
    })
    offlineState.reset()
  },
}
