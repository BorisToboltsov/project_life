import { api, configureAuth, type Schemas } from '@/api/client'
import { setLanguage } from '@/i18n'
import { offlineSession } from '@/offline/session'
import { offlineState } from '@/offline/store'

export type User = Schemas['UserOut']

export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  /** Сервер недоступен, и выяснить, вошёл ли пользователь, не удалось. */
  | { status: 'offline'; user: null }
  | { status: 'authenticated'; user: User }

// Отметка «на этом устройстве входили»: без неё приложение не дёргает обновление токена
// у того, кто заведомо не вошёл. Сам токен в хранилище не попадает (ADR 0001).
const HINT_KEY = 'life.session'

let state: SessionState = { status: 'loading', user: null }
let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null
const listeners = new Set<() => void>()

function setState(next: SessionState): void {
  state = next
  for (const listener of listeners) listener()
}

function hint(present?: boolean): boolean {
  try {
    if (present === true) localStorage.setItem(HINT_KEY, '1')
    if (present === false) localStorage.removeItem(HINT_KEY)
    return localStorage.getItem(HINT_KEY) !== null
  } catch {
    return present ?? true
  }
}

function open(issued: Schemas['SessionOut']): void {
  accessToken = issued.access_token
  hint(true)
  void setLanguage(issued.user.language)
  setState({ status: 'authenticated', user: issued.user })
}

function close(): void {
  accessToken = null
  hint(false)
  setState({ status: 'anonymous', user: null })
}

async function openOffline(): Promise<void> {
  const user = await offlineSession.cachedUser()
  if (!user) {
    setState({ status: 'offline', user: null })
    return
  }
  offlineState.setOnline(false)
  void setLanguage(user.language)
  setState({ status: 'authenticated', user })
}

async function refreshOnce(): Promise<boolean> {
  const { data, response } = await api.POST('/api/auth/refresh')
  if (data) {
    open(data)
    return true
  }
  if (response.status === 401) close()
  return false
}

/** Обновление сессии; параллельные вызовы ждут один общий запрос. */
function refresh(): Promise<boolean> {
  refreshing ??= refreshOnce().finally(() => {
    refreshing = null
  })
  return refreshing
}

configureAuth({ getToken: () => accessToken, refresh })

// Выход в одной вкладке закрывает сессию и в остальных.
window.addEventListener('storage', (event) => {
  if (event.key === HINT_KEY && event.newValue === null && state.status === 'authenticated') {
    close()
  }
})

export const session = {
  getState: (): SessionState => state,

  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /**
   * Старт приложения: восстановить сессию по refresh-cookie, если на устройстве входили. Без
   * связи приложение открывается на копии того, кто входил (ADR 0001, ADR 0020): токен
   * обновится, когда сервер снова ответит.
   */
  async bootstrap(): Promise<void> {
    if (!hint()) {
      accessToken = null
      setState({ status: 'anonymous', user: null })
      return
    }
    setState({ status: 'loading', user: null })
    try {
      // Сервер ответил, но не 200 и не 401 (например, 502): тоже считаем, что его нет.
      if (!(await refresh()) && state.status === 'loading') await openOffline()
    } catch {
      await openOffline()
    }
  },

  /** Вход, регистрация и смена пароля отдают новую сессию — она применяется здесь. */
  open,

  /** Профиль изменился на сервере — обновить его копию и язык интерфейса. */
  updateUser(user: User): void {
    void setLanguage(user.language)
    setState({ status: 'authenticated', user })
  },

  /** Выход стирает с устройства копию и неотправленные изменения (ADR 0020). */
  async logout(): Promise<void> {
    try {
      await api.POST('/api/auth/logout')
    } catch {
      // Без сети сессия на сервере доживёт свой срок, а устройство забудет её сразу.
    } finally {
      await offlineSession.erase()
      close()
    }
  },

  async logoutEverywhere(): Promise<void> {
    try {
      await api.POST('/api/auth/logout-all')
    } finally {
      await offlineSession.erase()
      close()
    }
  },
}
