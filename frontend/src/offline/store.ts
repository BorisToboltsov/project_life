import { useSyncExternalStore } from 'react'

import { db, type Rejected } from './db'

export interface OfflineState {
  /** Сервер отвечает. `false` — записи идут сразу в очередь (ADR 0020). */
  online: boolean
  /** Очередь отправляется прямо сейчас. */
  sending: boolean
  /** Сколько изменений ждёт отправки. */
  queued: number
  /** Ключи записей, изменения которых ещё не дошли до сервера. */
  pending: ReadonlySet<string>
  rejected: readonly Rejected[]
}

const initial: OfflineState = {
  online: true,
  sending: false,
  queued: 0,
  pending: new Set(),
  rejected: [],
}

let state = initial
const listeners = new Set<() => void>()

function set(next: Partial<OfflineState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/** Состояние записи без сети: экраны подписываются на него, модули читают напрямую. */
export const offlineState = {
  get: (): OfflineState => state,

  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  setOnline(online: boolean): void {
    if (state.online !== online) set({ online })
  },

  setSending(sending: boolean): void {
    if (state.sending !== sending) set({ sending })
  },

  /** Перечитывает очередь и отказы из базы после любого их изменения. */
  async reload(): Promise<void> {
    const [queue, rejected] = await Promise.all([
      db.queue.orderBy('seq').toArray(),
      db.rejected.orderBy('seq').toArray(),
    ])
    set({
      queued: queue.length,
      pending: new Set(
        queue.flatMap((change) => [
          ...Object.values(change.params),
          ...(change.context.workoutId ? [change.context.workoutId] : []),
        ]),
      ),
      rejected,
    })
  },

  /** Начальное состояние — между тестами и после выхода. */
  reset(): void {
    state = initial
    for (const listener of listeners) listener()
  },
}

export function useOfflineState(): OfflineState {
  return useSyncExternalStore(offlineState.subscribe, offlineState.get)
}
