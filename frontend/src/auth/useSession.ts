import { useSyncExternalStore } from 'react'

import { session, type SessionState, type User } from './session'

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getState)
}

/** Для экранов под защитой маршрута: пользователь там есть всегда. */
export function useUser(): User {
  const { user } = useSession()
  if (!user) throw new Error('useUser вызван вне защищённого маршрута')
  return user
}
