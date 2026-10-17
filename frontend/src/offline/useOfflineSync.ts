import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { Schemas } from '@/api/client'

import { offlineSession } from './session'
import { startSync } from './sync'

/**
 * Копия и очередь вошедшего пользователя (ADR 0020). Сначала копия переходит к нему — чужая
 * очередь стирается раньше, чем что-то уйдёт с его токеном, — затем запускается отправка.
 * Когда связь вернулась и очередь опустела, экраны перечитывают данные с сервера.
 */
export function useOfflineSync(user: Schemas['UserOut']): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void offlineSession.claim(user).then(() => {
      if (!cancelled) stop = startSync(() => void queryClient.invalidateQueries())
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [user, queryClient])
}
