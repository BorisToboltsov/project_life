/** Когда кончится отсчёт: живёт в сеансе вкладки, как отсчёт отдыха (ADR 0021). */
const KEY = 'cooper-timer'

export function readUntil(): number | null {
  try {
    const value = Number(sessionStorage.getItem(KEY))
    return value > 0 ? value : null
  } catch {
    return null
  }
}

export function writeUntil(until: number | null): void {
  try {
    if (until === null) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, String(until))
  } catch {
    // Хранилище сеанса недоступно: отсчёт живёт, пока открыт экран.
  }
}

/** Отсчёт уже идёт — «Как проводить тест» открыт, чтобы таймер был виден. */
export function timerRunning(): boolean {
  return readUntil() !== null
}
