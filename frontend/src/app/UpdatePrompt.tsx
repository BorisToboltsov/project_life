import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { appUpdate } from './appUpdate'

/**
 * Строка «Доступна новая версия» вверху экрана. Пока её не нажали, работает прежняя версия
 * целиком: обновление не перезагружает страницу посреди ввода.
 */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const ready = useSyncExternalStore(appUpdate.subscribe, appUpdate.isReady)
  if (!ready) return null
  return (
    <div
      role="status"
      className="sticky top-0 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-muted px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm"
    >
      <span>{t('update.ready')}</span>
      <Button size="sm" onClick={appUpdate.apply}>
        {t('update.apply')}
      </Button>
    </div>
  )
}
