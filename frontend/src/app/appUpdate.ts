/**
 * Новая версия приложения (ADR 0009). Service worker скачивает её в фоне и ждёт: включить
 * её — значит перезагрузить страницу, поэтому решает пользователь, а не приложение.
 */

type Listener = () => void

let reload: (() => void) | null = null
const listeners = new Set<Listener>()

export const appUpdate = {
  /** Новая версия скачана; `apply` включает её и перезагружает страницу. */
  offer(apply: () => void): void {
    reload = apply
    for (const listener of listeners) listener()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  isReady: (): boolean => reload !== null,
  apply(): void {
    reload?.()
  },
  /** Возвращает к «новой версии нет» — между тестами. */
  reset(): void {
    reload = null
    for (const listener of listeners) listener()
  },
}

/** Как часто открытое приложение само спрашивает сервер о новой версии, мс. */
const CHECK_INTERVAL = 60 * 60 * 1000

/**
 * Приложение на телефоне живёт в памяти днями и страницу не перезагружает: о новой версии
 * оно спрашивает, когда его снова открывают, но не чаще раза в час.
 */
export function watchForUpdates(registration: { update(): Promise<unknown> }): void {
  let checkedAt = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - checkedAt < CHECK_INTERVAL) return
    checkedAt = Date.now()
    // Нет сети — спросим в следующий раз.
    void registration.update().catch(() => {})
  })
}
